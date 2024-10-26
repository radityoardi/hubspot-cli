// @ts-nocheck
const chalk = require('chalk');
const { getAccountConfig } = require('@hubspot/local-dev-lib/config');
const { logger } = require('@hubspot/local-dev-lib/logger');
const supportsHyperlinks = require('./supportHyperlinks');
const supportsColor = require('./supportsColor');
const { i18n } = require('../lang');

const {
  HUBSPOT_ACCOUNT_TYPE_STRINGS,
} = require('@hubspot/local-dev-lib/constants/config');

const UI_COLORS = {
  SORBET: '#FF8F59',
  MARIGOLD: '#f5c26b',
  MARIGOLD_DARK: '#dbae60',
};

/**
 * Outputs horizontal line
 *
 * @returns
 */
const uiLine = () => {
  logger.log('-'.repeat(50));
};

/**
 * Returns an object that aggregates what the terminal supports (eg. hyperlinks and color)
 *
 * @returns {object}
 */

const getTerminalUISupport = () => {
  return {
    hyperlinks: supportsHyperlinks.stdout,
    color: supportsColor.stdout.hasBasic,
  };
};

/**
 * Returns a hyperlink or link and description
 *
 * @param {string} linkText
 * @param {string} url
 * @param {object} options
 * @returns {string}
 */
const uiLink = (linkText, url) => {
  const terminalUISupport = getTerminalUISupport();
  const encodedUrl = encodeURI(url);

  if (terminalUISupport.hyperlinks) {
    const CLOSE_SEQUENCE = '\u001B]8;;\u0007';

    const result = [
      '\u001B]8;;',
      encodedUrl,
      '\u0007',
      linkText,
      CLOSE_SEQUENCE,
    ].join('');

    return terminalUISupport.color ? chalk.cyan(result) : result;
  }

  return terminalUISupport.color
    ? `${linkText}: ${chalk.reset.cyan(encodedUrl)}`
    : `${linkText}: ${encodedUrl}`;
};

/**
 * Returns formatted account name, account type (if applicable), and ID
 *
 * @param {number} accountId
 * @param {boolean} bold
 * @returns {string}
 */
const uiAccountDescription = (accountId, bold = true) => {
  const account = getAccountConfig(accountId);
  const message = `${account.name} [${
    HUBSPOT_ACCOUNT_TYPE_STRINGS[account.accountType]
  }] (${account.portalId})`;
  return bold ? chalk.bold(message) : message;
};

const uiInfoSection = (title, logContent) => {
  uiLine();
  logger.log(chalk.bold(title));
  logger.log('');
  logContent();
  logger.log('');
  uiLine();
};

const uiCommandReference = command => {
  const terminalUISupport = getTerminalUISupport();

  const commandReference = `\`${command}\``;

  return chalk.bold(
    terminalUISupport.color
      ? chalk.hex(UI_COLORS.MARIGOLD_DARK)(commandReference)
      : commandReference
  );
};

const uiFeatureHighlight = (commands, title) => {
  const i18nKey = 'lib.ui.featureHighlight';

  uiInfoSection(title ? title : i18n(`${i18nKey}.defaultTitle`), () => {
    commands.forEach((c, i) => {
      const commandKey = `${i18nKey}.commandKeys.${c}`;
      const message = i18n(`${commandKey}.message`, {
        command: uiCommandReference(i18n(`${commandKey}.command`)),
        link: uiLink(i18n(`${commandKey}.linkText`), i18n(`${commandKey}.url`)),
      });
      if (i !== 0) {
        logger.log('');
      }
      logger.log(message);
    });
  });
};

const uiBetaTag = (message, log = true) => {
  const i18nKey = 'lib.ui';

  const terminalUISupport = getTerminalUISupport();
  const tag = i18n(`${i18nKey}.betaTag`);

  const result = `${
    terminalUISupport.color ? chalk.hex(UI_COLORS.SORBET)(tag) : tag
  } ${message}`;

  if (log) {
    logger.log(result);
  } else {
    return result;
  }
};

const uiDeprecatedTag = (message, log = true) => {
  const i18nKey = 'lib.ui';

  const terminalUISupport = getTerminalUISupport();
  const tag = i18n(`${i18nKey}.deprecatedTag`);

  const result = `${
    terminalUISupport.color ? chalk.yellow(tag) : tag
  } ${message}`;

  if (log) {
    logger.log(result);
  } else {
    return result;
  }
};

const uiCommandDisabledBanner = (
  command,
  url = undefined,
  message = undefined
) => {
  const i18nKey = 'lib.ui';

  const tag =
    message ||
    i18n(`${i18nKey}.disabledMessage`, {
      command: uiCommandReference(command),
      url: url ? uiLink(i18n(`${i18nKey}.disabledUrlText`), url) : undefined,
      npmCommand: uiCommandReference('npm i -g @hubspot/cli@latest'),
    });

  logger.log();
  uiLine();
  logger.error(tag);
  uiLine();
  logger.log();
};

const uiDeprecatedDescription = (
  message,
  command,
  url = undefined,
  log = false
) => {
  const i18nKey = 'lib.ui';

  const tag = i18n(`${i18nKey}.deprecatedDescription`, {
    message,
    command: uiCommandReference(command),
    url,
  });
  return uiDeprecatedTag(tag, log);
};

const uiDeprecatedMessage = (command, url = undefined, message = undefined) => {
  const i18nKey = 'lib.ui';

  const tag =
    message ||
    i18n(`${i18nKey}.deprecatedMessage`, {
      command: uiCommandReference(command),
      url: url ? uiLink(i18n(`${i18nKey}.deprecatedUrlText`), url) : undefined,
    });

  logger.log();
  uiDeprecatedTag(tag, true);
  logger.log();
};

module.exports = {
  UI_COLORS,
  uiAccountDescription,
  uiCommandReference,
  uiBetaTag,
  uiDeprecatedTag,
  uiFeatureHighlight,
  uiInfoSection,
  uiLine,
  uiLink,
  uiDeprecatedMessage,
  uiDeprecatedDescription,
  uiCommandDisabledBanner,
};
