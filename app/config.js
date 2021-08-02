/**
 * IMPORTANT (PLEASE READ THIS):
 *
 * This is not the "configuration file" of mediasoup. This is the configuration
 * file of the mediasoup-demo app. mediasoup itself is a server-side library, it
 * does not read any "configuration file". Instead it exposes an API. This demo
 * application just reads settings from this file (once copied to config.js) and
 * calls the mediasoup API with those settings when appropriate.
 */

const os = require('os');
module.exports =
{
	// Listening hostname (just for `gulp live` task).
	domain : process.env.DOMAIN || 'localhost',
	// Signaling settings (protoo WebSocket server and HTTP API server).
	https  :
	{
		listenIp   : '0.0.0.0',
		// NOTE: Don't change listenPort (client app assumes 4443).
		listenPort : process.env.PROTOO_LISTEN_PORT || 4443,
		// NOTE: Set your own valid certificate files.
		tls        :
		{
			cert : process.env.HTTPS_CERT_FULLCHAIN || `${__dirname}/../certs/server.crt`,
			key  : process.env.HTTPS_CERT_PRIVKEY || `${__dirname}/../certs/server.key`
		}
	},
};
