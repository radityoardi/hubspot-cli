// @ts-nocheck
const { AxiosError, HttpStatusCode } = require('axios');
const yargs = require('yargs');
const chalk = require('chalk');
const {
  HubSpotHttpError,
} = require('@hubspot/local-dev-lib/models/HubSpotHttpError');
const { getAccountConfig } = require('@hubspot/local-dev-lib/config');
const { logger } = require('@hubspot/local-dev-lib/logger');
const {
  deployProject,
  fetchProject,
} = require('@hubspot/local-dev-lib/api/projects');
const ui = require('../../../lib/ui');
const {
  addAccountOptions,
  addConfigOptions,
  getAccountId,
  addUseEnvironmentOptions,
} = require('../../../lib/commonOpts');
const { loadAndValidateOptions } = require('../../../lib/validation');
const {
  getProjectConfig,
  pollDeployStatus,
  getProjectDetailUrl,
} = require('../../../lib/projects');
const { projectNamePrompt } = require('../../../lib/prompts/projectNamePrompt');
const {
  deployBuildIdPrompt,
} = require('../../../lib/prompts/deployBuildIdPrompt');
const { trackCommandUsage } = require('../../../lib/usageTracking');
const { EXIT_CODES } = require('../../../lib/enums/exitCodes');

jest.mock('yargs');
jest.mock('@hubspot/local-dev-lib/logger');
jest.mock('@hubspot/local-dev-lib/api/projects');
jest.mock('@hubspot/local-dev-lib/config');
jest.mock('../../../lib/commonOpts');
jest.mock('../../../lib/validation');
jest.mock('../../../lib/projects');
jest.mock('../../../lib/prompts/projectNamePrompt');
jest.mock('../../../lib/prompts/deployBuildIdPrompt');
jest.mock('../../../lib/usageTracking');
jest.spyOn(ui, 'uiLine');
const uiLinkSpy = jest.spyOn(ui, 'uiLink').mockImplementation(text => text);
const uiCommandReferenceSpy = jest.spyOn(ui, 'uiCommandReference');
const uiAccountDescriptionSpy = jest.spyOn(ui, 'uiAccountDescription');

// Import this last so mocks apply
const deployCommand = require('../deploy');

describe('commands/project/deploy', () => {
  const projectFlag = 'project';
  const buildFlag = 'build';
  const buildAliases = ['buildId'];

  describe('command', () => {
    it('should have the correct command structure', () => {
      expect(deployCommand.command).toEqual('deploy');
    });
  });

  describe('describe', () => {
    it('should contain the beta tag', () => {
      expect(deployCommand.describe).toContain('[BETA]');
    });

    it('should provide a description', () => {
      expect(deployCommand.describe).toBeDefined();
    });
  });

  describe('builder', () => {
    it('should support the correct options', () => {
      deployCommand.builder(yargs);

      expect(yargs.options).toHaveBeenCalledTimes(1);
      expect(yargs.options).toHaveBeenCalledWith({
        [projectFlag]: expect.objectContaining({ type: 'string' }),
        [buildFlag]: expect.objectContaining({
          alias: buildAliases,
          type: 'number',
        }),
      });

      expect(addConfigOptions).toHaveBeenCalledTimes(1);
      expect(addConfigOptions).toHaveBeenCalledWith(yargs);

      expect(addAccountOptions).toHaveBeenCalledTimes(1);
      expect(addAccountOptions).toHaveBeenCalledWith(yargs);

      expect(addUseEnvironmentOptions).toHaveBeenCalledTimes(1);
      expect(addUseEnvironmentOptions).toHaveBeenCalledWith(yargs);
    });

    it('should provide examples', () => {
      deployCommand.builder(yargs);

      expect(yargs.example).toHaveBeenCalledTimes(1);
    });
  });

  describe('handler', () => {
    let projectConfig;
    let processExitSpy;
    const accountId = 1234567890;
    const accountType = 'STANDARD';
    let options;
    const projectDetails = {
      latestBuild: { buildId: 8 },
      deployedBuildId: 1,
    };
    const deployDetails = {
      id: 123,
    };
    const projectDetailUrl = 'http://project-details-page-url.com';
    const viewProjectsInHubSpot = 'View project builds in HubSpot';

    beforeEach(() => {
      options = {
        project: 'project name from options',
        buildId: 2,
        accountId,
      };
      projectConfig = {
        name: 'project name from config',
      };
      getProjectConfig.mockResolvedValue({ projectConfig });
      projectNamePrompt.mockResolvedValue({ projectName: 'fooo' });
      getProjectDetailUrl.mockReturnValue(projectDetailUrl);
      getAccountId.mockReturnValue(accountId);
      getAccountConfig.mockReturnValue({ accountType });
      fetchProject.mockResolvedValue({ data: projectDetails });
      deployProject.mockResolvedValue({ data: deployDetails });
      deployBuildIdPrompt.mockResolvedValue({
        buildId: projectDetails.latestBuild.buildId,
      });

      // Spy on process.exit so our tests don't close when it's called
      processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    it('should load and validate the options', async () => {
      await deployCommand.handler(options);
      expect(loadAndValidateOptions).toHaveBeenCalledTimes(1);
      expect(loadAndValidateOptions).toHaveBeenCalledWith(options);
    });

    it('should get the account id from the options', async () => {
      await deployCommand.handler(options);
      expect(getAccountId).toHaveBeenCalledTimes(1);
      expect(getAccountId).toHaveBeenCalledWith(options);
    });

    it('should load the account config for the correct account id', async () => {
      await deployCommand.handler(options);
      expect(getAccountConfig).toHaveBeenCalledTimes(1);
      expect(getAccountConfig).toHaveBeenCalledWith(accountId);
    });

    it('should track the command usage', async () => {
      await deployCommand.handler(options);
      expect(trackCommandUsage).toHaveBeenCalledTimes(1);
      expect(trackCommandUsage).toHaveBeenCalledWith(
        'project-deploy',
        { type: accountType },
        accountId
      );
    });

    it('should load the project config', async () => {
      await deployCommand.handler(options);
      expect(getProjectConfig).toHaveBeenCalledTimes(1);
      expect(getProjectConfig).toHaveBeenCalledWith();
    });

    it('should load the project config', async () => {
      await deployCommand.handler(options);
      expect(getProjectConfig).toHaveBeenCalledTimes(1);
      expect(getProjectConfig).toHaveBeenCalledWith();
    });

    it('should prompt for the project name', async () => {
      await deployCommand.handler(options);
      expect(projectNamePrompt).toHaveBeenCalledTimes(1);
      expect(projectNamePrompt).toHaveBeenCalledWith(accountId, {
        project: options.project,
      });
    });

    it('should use the project name from the config is a project options is not provided', async () => {
      delete options.project;
      await deployCommand.handler(options);
      expect(projectNamePrompt).toHaveBeenCalledTimes(1);
      expect(projectNamePrompt).toHaveBeenCalledWith(accountId, {
        project: projectConfig.name,
      });
    });

    it('should fetch the project details', async () => {
      await deployCommand.handler(options);
      expect(fetchProject).toHaveBeenCalledTimes(1);
      expect(fetchProject).toHaveBeenCalledWith(accountId, options.project);
    });

    it('should use the name from the prompt if no others are defined', async () => {
      delete options.project;
      const promptProjectName = 'project name from the prompt';
      projectNamePrompt.mockReturnValue({ projectName: promptProjectName });
      getProjectConfig.mockResolvedValue({});

      await deployCommand.handler(options);

      expect(projectNamePrompt).toHaveBeenCalledTimes(1);
      expect(projectNamePrompt).toHaveBeenCalledWith(accountId, {});
      expect(fetchProject).toHaveBeenCalledTimes(1);
      expect(fetchProject).toHaveBeenCalledWith(accountId, promptProjectName);
    });

    it('should log an error and exit when latest build is not defined', async () => {
      fetchProject.mockResolvedValue({ data: {} });
      await deployCommand.handler(options);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Deploy error: no builds for this project were found.'
      );
      expect(processExitSpy).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    });

    it('should log an error and exit when buildId option is not a valid build', async () => {
      options.buildId = projectDetails.latestBuild.buildId + 1;
      await deployCommand.handler(options);
      expect(uiLinkSpy).toHaveBeenCalledTimes(1);
      expect(uiLinkSpy).toHaveBeenCalledWith(
        viewProjectsInHubSpot,
        projectDetailUrl
      );
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        `Build ${options.buildId} does not exist for project ${options.project}. ${viewProjectsInHubSpot}`
      );
      expect(processExitSpy).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    });

    it('should log an error and exit when buildId option is already deployed', async () => {
      options.buildId = projectDetails.deployedBuildId;
      await deployCommand.handler(options);
      expect(uiLinkSpy).toHaveBeenCalledTimes(1);
      expect(uiLinkSpy).toHaveBeenCalledWith(
        viewProjectsInHubSpot,
        projectDetailUrl
      );
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        `Build ${options.buildId} is already deployed. ${viewProjectsInHubSpot}`
      );
      expect(processExitSpy).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    });

    it('should prompt for build id if no option is provided', async () => {
      delete options.buildId;
      await deployCommand.handler(options);
      expect(deployBuildIdPrompt).toHaveBeenCalledTimes(1);
      expect(deployBuildIdPrompt).toHaveBeenCalledWith(
        projectDetails.latestBuild.buildId,
        projectDetails.deployedBuildId,
        expect.any(Function)
      );
    });

    it('should log an error and exit if the prompted value is invalid', async () => {
      delete options.buildId;
      deployBuildIdPrompt.mockReturnValue({});

      await deployCommand.handler(options);

      expect(deployBuildIdPrompt).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'You must specify a build to deploy'
      );
      expect(processExitSpy).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    });

    it('should deploy the project', async () => {
      await deployCommand.handler(options);
      expect(deployProject).toHaveBeenCalledTimes(1);
      expect(deployProject).toHaveBeenCalledWith(
        accountId,
        options.project,
        options.buildId
      );
    });

    it('should log an error and exit when the deploy fails', async () => {
      const errorMessage = `Just wasn't feeling it`;
      deployProject.mockResolvedValue({
        data: {
          error: { message: errorMessage },
        },
      });

      await deployCommand.handler(options);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        `Deploy error: ${errorMessage}`
      );
      expect(processExitSpy).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    });

    it('should poll the deploy status', async () => {
      await deployCommand.handler(options);
      expect(pollDeployStatus).toHaveBeenCalledTimes(1);
      expect(pollDeployStatus).toHaveBeenCalledWith(
        accountId,
        options.project,
        deployDetails.id,
        options.buildId
      );
    });

    it('log an error and exit if a 404 status is returned', async () => {
      const commandReference = 'hs project upload';
      const accountDescription = 'SuperCoolTestAccount';
      uiCommandReferenceSpy.mockReturnValueOnce(commandReference);
      uiAccountDescriptionSpy.mockReturnValueOnce(accountDescription);
      fetchProject.mockImplementation(() => {
        throw new HubSpotHttpError('OH NO', {
          cause: new AxiosError(
            'OH NO',
            '',
            {},
            {},
            { status: HttpStatusCode.NotFound }
          ),
        });
      });
      await deployCommand.handler(options);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        `The project ${chalk.bold(
          options.project
        )} does not exist in account ${accountDescription}. Run ${commandReference} to upload your project files to HubSpot.`
      );
      expect(processExitSpy).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    });

    it('log an error and exit if a 400 status is returned', async () => {
      const errorMessage = 'Something bad happened';
      fetchProject.mockImplementation(() => {
        throw new HubSpotHttpError(errorMessage, {
          cause: new AxiosError(
            errorMessage,
            '',
            {},
            {},
            { status: HttpStatusCode.BadRequest }
          ),
        });
      });
      await deployCommand.handler(options);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('The request was bad.');
      expect(processExitSpy).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    });

    it('log an error another unexpected status code is returned', async () => {
      const errorMessage = 'Something bad happened';
      fetchProject.mockImplementation(() => {
        throw new HubSpotHttpError('OH NO', {
          cause: new AxiosError(
            errorMessage,
            '',
            {},
            {},
            { status: HttpStatusCode.MethodNotAllowed }
          ),
        });
      });
      await deployCommand.handler(options);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        `The request for 'project deploy' in account ${accountId} failed due to a client error.`
      );
      expect(processExitSpy).toHaveBeenCalledTimes(1);
      expect(processExitSpy).toHaveBeenCalledWith(EXIT_CODES.ERROR);
    });
  });
});
