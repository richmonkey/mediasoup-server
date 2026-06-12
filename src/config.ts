/**
 * IMPORTANT (PLEASE READ THIS):
 *
 * This is not the "configuration file" of mediasoup. This is the configuration
 * file of the mediasoup-demo app. mediasoup itself is a server-side library, it
 * does not read any "configuration file". Instead it exposes an API. This demo
 * application just reads settings from this file (once copied to config.js) and
 * calls the mediasoup API with those settings when appropriate.
 */

const config = {
	http :
	{
		listenIp   : '0.0.0.0',
		listenPort : 4444,
	},
	
	// mediasoup settings.
	mediasoup :
	{
		// Number of mediasoup workers to launch.
		//numWorkers     : Object.keys(os.cpus()).length,
		numWorkers     : 1,
		// mediasoup WorkerSettings.
		// See https://mediasoup.org/documentation/v3/mediasoup/api/#WorkerSettings
		workerSettings :
		{
			logLevel : 'warn',
			logTags  :
			[
				'info',
				'ice',
				'dtls',
				'rtp',
				'srtp',
				'rtcp',
				'rtx',
				'bwe',
				'score',
				'simulcast',
				'svc',
				'sctp'
			],
			rtcMinPort : process.env.MEDIASOUP_MIN_PORT || 40000,
			rtcMaxPort : process.env.MEDIASOUP_MAX_PORT || 49999
		},
		// mediasoup Router options.
		// See https://mediasoup.org/documentation/v3/mediasoup/api/#RouterOptions
		routerOptions :
		{
			mediaCodecs :
			[
				{
					kind      : 'audio' as "audio",
					mimeType  : 'audio/opus',
					clockRate : 48000,
					channels  : 2
				},
				{
					kind       : 'video' as "video",
					mimeType   : 'video/VP8',
					clockRate  : 90000,
					parameters :
					{
						'x-google-start-bitrate' : 1000
					}
				},
				{
					kind       : 'video' as "video",
					mimeType   : 'video/VP9',
					clockRate  : 90000,
					parameters :
					{
						'profile-id'             : 2,
						'x-google-start-bitrate' : 1000
					}
				},
				{
					kind       : 'video' as "video",
					mimeType   : 'video/h264',
					clockRate  : 90000,
					parameters :
					{
						'packetization-mode'      : 1,
						'profile-level-id'        : '4d0032',
						'level-asymmetry-allowed' : 1,
						'x-google-start-bitrate'  : 1000
					}
				},
				{
					kind       : 'video' as "video",
					mimeType   : 'video/h264',
					clockRate  : 90000,
					parameters :
					{
						'packetization-mode'      : 1,
						'profile-level-id'        : '42e01f',
						'level-asymmetry-allowed' : 1,
						'x-google-start-bitrate'  : 1000
					}
				}
			]
		},
		// mediasoup WebRtcTransport options for WebRTC endpoints (mediasoup-client,
		// libmediasoupclient).
		// See https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
		webRtcTransportOptions :
		{
			listenIps :
			[
				{
					ip          : process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
					announcedIp : process.env.MEDIASOUP_ANNOUNCED_IP || "192.168.1.198"
				}
			],
			initialAvailableOutgoingBitrate : 1000000,
			minimumAvailableOutgoingBitrate : 600000,
			maxSctpMessageSize              : 262144,
			// Additional options that are not part of WebRtcTransportOptions.
			maxIncomingBitrate              : 1500000
		},
		// mediasoup PlainTransport options for legacy RTP endpoints (FFmpeg,
		// GStreamer).
		// See https://mediasoup.org/documentation/v3/mediasoup/api/#PlainTransportOptions
		plainTransportOptions :
		{
			listenIp :
			{
				ip          : process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
				announcedIp : process.env.MEDIASOUP_ANNOUNCED_IP || "192.168.1.198"
			},
			maxSctpMessageSize : 262144,
			rtcpMux:false
		}
	},
	redis: {
		host:"192.168.33.10",
		port:"6379",
		password:"123456",
		db:undefined,
	},
	auth: {
		enabled:false
	}
};
export default config;