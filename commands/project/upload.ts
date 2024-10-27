// @ts-nocheck
const {
  addAccountOptions,
  addConfigOptions,
  getAccountId,
  addUseEnvironmentOptions,
} = require('../../lib/commonOpts');
const chalk = require('chalk');
const { logger } = require('@hubspot/local-dev-lib/logger');
const { uiBetaTag, uiCommandReference } = require('../../lib/ui');
const { trackCommandUsage } = require('../../lib/usageTracking');
const { loadAndValidateOptions } = require('../../lib/validation');
const {
  ensureProjectExists,
  getProjectConfig,
  handleProjectUpload,
  logFeedbackMessage,
  validateProjectConfig,
  pollProjectBuildAndDeploy,
  displayWarnLogs,
} = require('../../lib/projects');
const { i18n } = require('../../lib/lang');
const { getAccountConfig } = require('@hubspot/local-dev-lib/config');
const { isSpecifiedError } = require('@hubspot/local-dev-lib/errors/index');
const { PROJECT_ERROR_TYPES } = require('../../lib/constants');
const { logError, ApiErrorContext } = require('../../lib/errorHandlers/index');
const { EXIT_CODES } = require('../../lib/enums/exitCodes');

const i18nKey = 'commands.project.subcommands.upload';

exports.command = 'upload [path] [--forceCreate] [--message]';
exports.describe = uiBetaTag(i18n(`${i18nKey}.describe`), false);

exports.handler = async options => {
  const keyInfo = `RD:`;
  logger.log(
    `${keyInfo} You are running hs project upload, load and validate options.`
  );
  await loadAndValidateOptions(options);

  const { forceCreate, path: projectPath, message } = options;
  logger.log(`${keyInfo} running getAccountId.`);
  const accountId = getAccountId(options);
  logger.log(`${keyInfo} running getAccountConfig.`);
  const accountConfig = getAccountConfig(accountId);
  logger.log(`${keyInfo} accountConfig result is >> ${accountConfig}`);
  const accountType = accountConfig && accountConfig.accountType;

  logger.log(`${keyInfo} running trackCommandUsage.`);
  trackCommandUsage('project-upload', { type: accountType }, accountId);

  logger.log(`${keyInfo} running getProjectConfig.`);
  const { projectConfig, projectDir } = await getProjectConfig(projectPath);
  logger.log(`${keyInfo} projectConfig and projectDir dump.`);
  logger.log(projectConfig);
  logger.log(projectDir);

  logger.log(`${keyInfo} running validateProjectConfig.`);
  validateProjectConfig(projectConfig, projectDir);

  logger.log(`${keyInfo} running ensureProjectExists.`);
  await ensureProjectExists(accountId, projectConfig.name, {
    forceCreate,
    uploadCommand: true,
  });

  try {
    logger.log(`${keyInfo} running handleProjectUpload`);
    const result = await handleProjectUpload(
      accountId,
      projectConfig,
      projectDir,
      pollProjectBuildAndDeploy,
      message
    );

    if (result.uploadError) {
      logger.log(`${keyInfo} goes into uploadError.`);
      if (
        isSpecifiedError(result.uploadError, {
          subCategory: PROJECT_ERROR_TYPES.PROJECT_LOCKED,
        })
      ) {
        logger.log();
        logger.error(i18n(`${i18nKey}.errors.projectLockedError`));
        logger.log();
      } else {
        logError(
          result.uploadError,
          new ApiErrorContext({
            accountId,
            request: 'project upload',
          })
        );
      }
      process.exit(EXIT_CODES.ERROR);
    }
    if (result.succeeded && !result.buildResult.isAutoDeployEnabled) {
      logger.log(
        chalk.bold(
          i18n(`${i18nKey}.logs.buildSucceeded`, {
            buildId: result.buildId,
          })
        )
      );
      logger.log(
        i18n(`${i18nKey}.logs.autoDeployDisabled`, {
          deployCommand: uiCommandReference(
            `hs project deploy --build=${result.buildId}`
          ),
        })
      );
      logFeedbackMessage(result.buildId);

      await displayWarnLogs(accountId, projectConfig.name, result.buildId);
      process.exit(EXIT_CODES.SUCCESS);
    }
  } catch (e) {
    logError(e, new ApiErrorContext({ accountId, request: 'project upload' }));
    process.exit(EXIT_CODES.ERROR);
  }
};

exports.builder = yargs => {
  yargs.positional('path', {
    describe: i18n(`${i18nKey}.positionals.path.describe`),
    type: 'string',
  });

  yargs.option('forceCreate', {
    describe: i18n(`${i18nKey}.options.forceCreate.describe`),
    type: 'boolean',
    default: false,
  });

  yargs.option('message', {
    alias: 'm',
    describe: i18n(`${i18nKey}.options.message.describe`),
    type: 'string',
    default: '',
  });

  yargs.example([
    ['$0 project upload myProjectFolder', i18n(`${i18nKey}.examples.default`)],
  ]);

  addConfigOptions(yargs);
  addAccountOptions(yargs);
  addUseEnvironmentOptions(yargs);

  return yargs;
};
