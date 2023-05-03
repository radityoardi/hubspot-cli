const chokidar = require('chokidar');
const path = require('path');
const { default: PQueue } = require('p-queue');
const { i18n } = require('@hubspot/cli-lib/lib/lang');
const { logger } = require('@hubspot/cli-lib/logger');
const {
  isSpecifiedError,
} = require('@hubspot/cli-lib/errorHandlers/apiErrors');
const { handleKeypress } = require('@hubspot/cli-lib/lib/process');
const {
  logApiErrorInstance,
  ApiErrorContext,
} = require('@hubspot/cli-lib/errorHandlers');
const { ERROR_TYPES } = require('@hubspot/cli-lib/lib/constants');
const { isAllowedExtension } = require('@hubspot/cli-lib/path');
const { shouldIgnoreFile } = require('@hubspot/cli-lib/ignoreRules');
const {
  cancelStagedBuild,
  uploadFileToBuild,
  deleteFileFromBuild,
  provisionBuild,
  queueBuild,
} = require('@hubspot/cli-lib/api/dfs');
const SpinniesManager = require('./SpinniesManager');
const { EXIT_CODES } = require('./enums/exitCodes');
const {
  getProjectDetailUrl,
  pollProjectBuildAndDeploy,
} = require('./projects');
const { uiAccountDescription, uiLink } = require('./ui');

const i18nKey = 'cli.lib.LocalDevManager';

const BUILD_DEBOUNCE_TIME = 2000;

const WATCH_EVENTS = {
  add: 'add',
  change: 'change',
  unlink: 'unlink',
  unlinkDir: 'unlinkDir',
};

class LocalDevManager {
  constructor(options) {
    this.targetAccountId = options.targetAccountId;
    this.projectConfig = options.projectConfig;
    this.projectDir = options.projectDir;
    this.preventUploads = options.preventUploads;
    this.debug = options.debug || false;
    this.mockServers = options.mockServers || false;
    this.projectSourceDir = path.join(
      this.projectDir,
      this.projectConfig.srcDir
    );
    this.spinnies = null;
    this.watcher = null;
    this.uploadQueue = null;
    this.standbyChanges = [];
    this.debouncedBuild = null;
    this.currentStagedBuildId = null;

    if (!this.targetAccountId || !this.projectConfig || !this.projectDir) {
      process.exit(EXIT_CODES.ERROR);
    }
  }

  async start() {
    this.spinnies = SpinniesManager.init();

    this.watcher = chokidar.watch(this.projectSourceDir, {
      ignoreInitial: true,
      ignored: file => shouldIgnoreFile(file),
    });

    this.uploadQueue = new PQueue({ concurrency: 10 });

    if (this.debug) {
      this.uploadQueue.on('error', error => {
        logger.debug(error);
      });
    }

    console.clear();

    this.uploadQueue.start();

    this.logConsoleHeader();
    await this.startServers();
    await this.startWatching();
    this.updateKeypressListeners();
  }

  async stop() {
    this.clearConsoleContent();

    this.spinnies.add('cleanupMessage', {
      text: i18n(`${i18nKey}.exitingStart`),
    });

    await this.stopWatching();

    await this.cleanupServers();

    let exitCode = EXIT_CODES.SUCCESS;

    if (this.currentStagedBuildId) {
      try {
        await cancelStagedBuild(this.targetAccountId, this.projectConfig.name);
      } catch (err) {
        if (
          !isSpecifiedError(err, {
            subCategory: ERROR_TYPES.BUILD_NOT_IN_PROGRESS,
          })
        ) {
          logApiErrorInstance(
            err,
            new ApiErrorContext({
              accountId: this.targetAccountId,
              projectName: this.projectConfig.name,
            })
          );
          exitCode = EXIT_CODES.ERROR;
        }
      }
    }

    if (exitCode === EXIT_CODES.SUCCESS) {
      this.spinnies.succeed('cleanupMessage', {
        text: i18n(`${i18nKey}.exitingSucceed`),
      });
    } else {
      this.spinnies.fail('cleanupMessage', {
        text: i18n(`${i18nKey}.exitingFail`),
      });
    }

    process.exit(exitCode);
  }

  logConsoleHeader() {
    this.spinnies.removeAll();
    this.spinnies.add('devModeRunning', {
      text: i18n(`${i18nKey}.running`),
      isParent: true,
      category: 'header',
    });
    this.spinnies.add('devModeStatus', {
      text: i18n(`${i18nKey}.status.clean`),
      status: 'non-spinnable',
      indent: 1,
      category: 'header',
    });
    // TODO long urls break the spinnies output
    const projectDetailUrl = getProjectDetailUrl(
      this.projectConfig.name,
      this.targetAccountId
    );
    this.spinnies.add('viewInHubSpotLink', {
      text: uiLink(i18n(`${i18nKey}.viewInHubSpot`), projectDetailUrl),
      status: 'non-spinnable',
      indent: 1,
      category: 'header',
    });
    this.spinnies.add('spacer-1', {
      text: ' ',
      status: 'non-spinnable',
      category: 'header',
    });
    this.spinnies.add('keypressMessage', {
      text: i18n(`${i18nKey}.quitHelper`),
      status: 'non-spinnable',
      indent: 1,
      category: 'header',
    });
    this.spinnies.add('lineSeparator', {
      text: '-'.repeat(50),
      status: 'non-spinnable',
      noIndent: true,
      category: 'header',
    });
  }

  clearConsoleContent() {
    this.spinnies.removeAll({ preserveCategory: 'header' });
  }

  updateKeypressListeners() {
    handleKeypress(async key => {
      if ((key.ctrl && key.name === 'c') || key.name === 'q') {
        this.stop();
      } else if (key.name === 'y') {
        if (this.preventUploads && this.hasAnyUnsupportedStandbyChanges()) {
          this.clearConsoleContent();
          this.updateDevModeStatus('manualUpload');
          await this.createNewStagingBuild();
          await this.flushStandbyChanges();
          await this.queueBuild();
        }
      } else if (key.name === 'n') {
        if (this.preventUploads && this.hasAnyUnsupportedStandbyChanges()) {
          this.clearConsoleContent();
          this.spinnies.add('manualUploadSkipped', {
            text: i18n(`${i18nKey}.upload.manualUploadSkipped`),
            status: 'fail',
            failColor: 'white',
            noIndent: true,
          });
        }
      }
    });
  }

  updateDevModeStatus(langKey) {
    this.spinnies.update('devModeStatus', {
      text: i18n(`${i18nKey}.status.${langKey}`),
      status: 'non-spinnable',
      noIndent: true,
    });
  }

  async pauseUploadQueue() {
    this.spinnies.add('uploading', {
      text: i18n(`${i18nKey}.upload.uploadingChanges`, {
        accountIdentifier: uiAccountDescription(this.targetAccountId),
      }),
      noIndent: true,
    });

    this.uploadQueue.pause();
    await this.uploadQueue.onIdle();
  }

  hasAnyUnsupportedStandbyChanges() {
    return this.standbyChanges.some(({ supported }) => !supported);
  }

  async createNewStagingBuild() {
    try {
      const { buildId } = await provisionBuild(
        this.targetAccountId,
        this.projectConfig.name
      );
      this.currentStagedBuildId = buildId;
    } catch (err) {
      logger.debug(err);
      if (isSpecifiedError(err, { subCategory: ERROR_TYPES.PROJECT_LOCKED })) {
        await cancelStagedBuild(this.targetAccountId, this.projectConfig.name);
        logger.log(i18n(`${i18nKey}.previousStagingBuildCancelled`));
      }
      process.exit(EXIT_CODES.ERROR);
    }
  }

  async startWatching() {
    if (!this.preventUploads) {
      await this.createNewStagingBuild();
    }

    this.watcher.on('add', async filePath => {
      this.handleWatchEvent(filePath, WATCH_EVENTS.add);
    });
    this.watcher.on('change', async filePath => {
      this.handleWatchEvent(filePath, WATCH_EVENTS.change);
    });
    this.watcher.on('unlink', async filePath => {
      this.handleWatchEvent(filePath, WATCH_EVENTS.unlink);
    });
    this.watcher.on('unlinkDir', async filePath => {
      this.handleWatchEvent(filePath, WATCH_EVENTS.unlinkDir);
    });
  }

  async handleWatchEvent(filePath, event) {
    const changeInfo = {
      event,
      filePath,
      remotePath: path.relative(this.projectSourceDir, filePath),
    };

    const isSupportedChange = await this.notifyServers(changeInfo);

    if (isSupportedChange) {
      this.updateDevModeStatus('supportedChange');
      this.addChangeToStandbyQueue({ ...changeInfo, supported: true });
      return;
    }

    if (this.preventUploads) {
      this.handlePreventedUpload(changeInfo);
      return;
    }

    if (this.uploadQueue.isPaused) {
      if (
        !this.standbyChanges.find(
          changeInfo => changeInfo.filePath === filePath
        )
      ) {
        this.addChangeToStandbyQueue({ ...changeInfo, supported: false });
      }
    } else {
      await this.flushStandbyChanges();

      if (!this.uploadQueue.isPaused) {
        this.debounceQueueBuild();
      }

      return this.uploadQueue.add(async () => {
        await this.sendChanges(changeInfo);
      });
    }
  }

  handlePreventedUpload(changeInfo) {
    this.clearConsoleContent();
    this.updateDevModeStatus('uploadPrevented');

    this.addChangeToStandbyQueue({ ...changeInfo, supported: false });

    this.spinnies.add('manualUploadRequired', {
      text: i18n(`${i18nKey}.upload.manualUploadRequired`),
      status: 'fail',
      failColor: 'white',
      noIndent: true,
    });
    this.spinnies.add('manualUploadExplanation1', {
      text: i18n(`${i18nKey}.upload.manualUploadExplanation1`),
      status: 'non-spinnable',
      indent: 1,
    });
    this.spinnies.add('manualUploadExplanation2', {
      text: i18n(`${i18nKey}.upload.manualUploadExplanation2`),
      status: 'non-spinnable',
      indent: 1,
    });
    this.spinnies.add('manualUploadPrompt', {
      text: i18n(`${i18nKey}.upload.manualUploadPrompt`),
      status: 'non-spinnable',
      indent: 1,
    });
  }

  addChangeToStandbyQueue(changeInfo) {
    if (
      changeInfo.event === WATCH_EVENTS.add ||
      changeInfo.event === WATCH_EVENTS.change
    ) {
      if (!isAllowedExtension(changeInfo.filePath)) {
        logger.debug(`Extension not allowed: ${changeInfo.filePath}`);
        return;
      }
    }
    if (shouldIgnoreFile(changeInfo.filePath, true)) {
      logger.debug(`File ignored: ${changeInfo.filePath}`);
      return;
    }
    this.standbyChanges.push(changeInfo);
  }

  async sendChanges(changeInfo) {
    this.spinnies.add(changeInfo.filePath, {
      text: i18n(`${i18nKey}.upload.uploadingChange`, {
        filePath: changeInfo.remotePath,
      }),
      status: 'non-spinnable',
    });
    try {
      if (
        changeInfo.event === WATCH_EVENTS.add ||
        changeInfo.event === WATCH_EVENTS.change
      ) {
        await uploadFileToBuild(
          this.targetAccountId,
          this.projectConfig.name,
          changeInfo.filePath,
          changeInfo.remotePath
        );
      } else if (
        changeInfo.event === WATCH_EVENTS.unlink ||
        changeInfo.event === WATCH_EVENTS.unlinkDir
      ) {
        await deleteFileFromBuild(
          this.targetAccountId,
          this.projectConfig.name,
          changeInfo.remotePath
        );
      }
    } catch (err) {
      logger.debug(err);
    }
  }

  debounceQueueBuild() {
    if (!this.preventUploads) {
      this.updateDevModeStatus('uploadPending');
    }

    if (this.debouncedBuild) {
      clearTimeout(this.debouncedBuild);
    }

    this.debouncedBuild = setTimeout(
      this.queueBuild.bind(this),
      BUILD_DEBOUNCE_TIME
    );
  }

  async queueBuild() {
    await this.pauseUploadQueue();

    try {
      await queueBuild(this.targetAccountId, this.projectConfig.name);
    } catch (err) {
      logger.debug(err);
      if (
        isSpecifiedError(err, {
          subCategory: ERROR_TYPES.MISSING_PROJECT_PROVISION,
        })
      ) {
        logger.log(i18n(`${i18nKey}.cancelledFromUI`));
        this.stop();
      } else {
        logApiErrorInstance(
          err,
          new ApiErrorContext({
            accountId: this.targetAccountId,
            projectName: this.projectConfig.name,
          })
        );
      }
      return;
    }

    await pollProjectBuildAndDeploy(
      this.targetAccountId,
      this.projectConfig,
      null,
      this.currentStagedBuildId,
      true
    );

    if (!this.preventUploads) {
      await this.createNewStagingBuild();
    }

    this.uploadQueue.start();
    this.clearConsoleContent();

    if (this.hasAnyUnsupportedStandbyChanges()) {
      this.flushStandbyChanges();
    } else {
      this.updateDevModeStatus('clean');
    }
  }

  async flushStandbyChanges() {
    if (this.standbyChanges.length) {
      await this.uploadQueue.addAll(
        this.standbyChanges.map(changeInfo => {
          return async () => {
            if (!this.preventUploads && !this.uploadQueue.isPaused) {
              this.debounceQueueBuild();
            }
            await this.sendChanges(changeInfo);
          };
        })
      );
      this.standbyChanges = [];
    }
  }

  async stopWatching() {
    await this.watcher.close();
  }

  async startServers() {
    // TODO spin up local dev servers
    return true;
  }

  async notifyServers(changeInfo) {
    // TODO notify servers of the change
    if (this.mockServers) {
      return !changeInfo.remotePath.endsWith('app.json');
    }
    return false;
  }

  async cleanupServers() {
    // TODO tell servers to cleanup
    return;
  }
}

module.exports = LocalDevManager;
