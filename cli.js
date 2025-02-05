#!/usr/bin/env node
/* eslint no-console: 0 */
const fs = require('fs');
const path = require('path');
const meow = require('meow');
const yaml = require('js-yaml');
const ngrok = require('ngrok');
const init = require('./lib/init');
const interpolate = require('./lib/interpolate');
const sendEmail = require('./lib/send-email');
const updateNotifier = require('update-notifier');
require('dotenv').config();
const pkg = require('./package.json');

const cli = meow(
  `
	Usage: ngrok-notify PROTO PORT [-n]
        ngrok-notify init [-f]

  Positional arguments:
    PROTO           Protocol to use in the ngrok tunnel {http,tcp,tls}
    PORT            Port number of the localhost service to expose (e.g. 8080)
    init            Copy starter config files into directory for customizing

  Optional arguments:
    -n, --noemail   Do not send an email providing the URL of the ngrok tunnel
    -h, --help      Show help
    -v, --version   Display version information
    -f, --force     Overwrite config files in directory if they exist.

  Notes
    Email messages are sent using the settings in the config.yml file and the
    Gmail password stored in the .env file.
  
  Examples
    Create ngrok tunnel to expose localhost web server running on port 8080.
    Email is sent with the ngrok URL since "--noemail" is not included.
    $ ngrok-notify http 8080
    
    Create ngrok tunnel to expose localhost web server running on port 8080,
    but don't send email.
    $ ngrok-notify http 8080 -n
`,
  {
    flags: {
      noemail: {
        type: 'boolean',
        alias: 'n'
      },
      force: {
        type: 'boolean',
        alias: 'f'
      },
      version: {
        type: 'boolean',
        alias: 'v'
      },
      help: {
        type: 'boolean',
        alias: 'h'
      }
    }
  }
);

const [command] = cli.input;
if (command === 'init') {
  init(cli.flags.f);
  process.exit(0);
}

const missingFiles = init.checkIfNeeded();
if (missingFiles) {
  console.log(missingFiles);
  console.log("Please run 'ngrok-notify init' to copy starter config files to your directory for customizing.")
  process.exit(1);
}

const cwd = process.cwd();
const config = yaml.safeLoad(
  fs.readFileSync(path.join(cwd, 'config.yml'), 'utf8')
);

const opts = config.ngrok || {};

if (cli.input.length < 2) {
  cli.showHelp();
} else {
  const [proto, strPort] = cli.input;

  opts.proto = proto;
  
  const isIntegerInRange = (i, min, max) =>
    Number.isInteger(i) && i >= min && i <= max;
  const PORT_MIN = 0;
  const PORT_MAX = 65535;

  const port = parseInt(strPort, 10);
  if (!isIntegerInRange(port, PORT_MIN, PORT_MAX)) {
    console.log(
      `Expected an integer for 'port' between ${PORT_MIN} and ${PORT_MAX} and received: ${strPort}`
    );
    process.exit(1);
  }
  // The ngrok npm package parlance uses "addr" instead of "port".
  opts.addr = port;
}

// Graft in secrets from .env file to pass to ngrok, if present.
const auth = process.env.NGROK_AUTH;
if (auth) opts.auth = auth;

const authtoken = process.env.NGROK_AUTHTOKEN;
if (authtoken) opts.authtoken = authtoken;

const emailOpts = config.email;

(async () => {
  const url = await ngrok.connect(opts);

  // Add url so it can be interpolated from the message text containing "{url}"
  opts.url = url;

  // Get Gmail password if set in .env file.
  if (process.env.GMAIL_PASSWORD)
    emailOpts.password = process.env.GMAIL_PASSWORD;

  // substitute values like {proto} with their configuration values
  // patch in property name of port since it's a more technically correct and known term.
  opts.port = opts.addr;
  const subject = interpolate(emailOpts.subject, opts);
  const message = interpolate(emailOpts.message, opts);

  const emailEnabled = !cli.flags.n;

  let emailTail = '';
  if (emailEnabled) {
    sendEmail(emailOpts, subject, message);
    emailTail = ' (email sent)';
  }
  console.log(`${message}${emailTail}`);

  updateNotifier({pkg}).notify();
})();
