import config from "./config";
import * as fs from "node:fs";
import * as https from "node:https";
import * as http from "node:http";
import * as url from "node:url";
import * as protoo from "protoo-server";
import * as mediasoup from "mediasoup";
import { AwaitQueue } from "awaitqueue";
import Room from "./Room";

const logger = console;

/**
 * Launch as many mediasoup Workers as given in the configuration file.
 */
export async function runMediasoupWorkers() {
	const {
		numWorkers
	} = config.mediasoup;

	logger.info('running %d mediasoup Workers...', numWorkers);

    const works:mediasoup.types.Worker[] = []
	for (let i = 0; i < numWorkers; ++i) {
		const worker = await mediasoup.createWorker({
			logLevel: config.mediasoup.workerSettings.logLevel as mediasoup.types.WorkerLogLevel,
			logTags: config.mediasoup.workerSettings.logTags as mediasoup.types.WorkerLogTag[],
			rtcMinPort: Number(config.mediasoup.workerSettings.rtcMinPort),
			rtcMaxPort: Number(config.mediasoup.workerSettings.rtcMaxPort)
		});

		worker.on('died', () => {
			logger.error(
				'mediasoup Worker died, exiting  in 2 seconds... [pid:%d]', worker.pid);

			setTimeout(() => process.exit(1), 2000);
		});

		works.push(worker);

		// Log worker resource usage every X seconds.
		const usageTimer = setInterval(async () => {
			const usage = await worker.getResourceUsage();

			logger.info('mediasoup Worker resource usage [pid:%d]: %o', worker.pid, usage);
		}, 120000);
		usageTimer.unref();
	}
    return works;
}



/**
 * Create a Node.js HTTPS server. It listens in the IP and port given in the
 * configuration file and reuses the Express application as request listener.
 */
export async function runHttpServer() {
	logger.info('running an HTTP server...');

	const httpServer = http.createServer({}, function (request, response) {
		console.log((new Date()) + ' Received request for ' + request.url);
		response.writeHead(404);
		response.end();
	});

	await new Promise<void>((resolve) => {
		httpServer.listen(
			Number(config.http.listenPort), config.http.listenIp, resolve);
	});
    return httpServer;
}

/**
 * Create a protoo WebSocketServer to allow WebSocket connections from browsers.
 */
export async function runProtooWebSocketServer(httpServer: https.Server|http.Server, queue: AwaitQueue, getOrCreateRoom:(roomId:string)=>Promise<Room>) {
	logger.info('running protoo WebSocketServer...');

	// Create the protoo WebSocket server.
	const protooWebSocketServer = new protoo.WebSocketServer(httpServer, {
		maxReceivedFrameSize: 960000, // 960 KBytes.
		maxReceivedMessageSize: 960000,
		fragmentOutgoingMessages: true,
		fragmentationThreshold: 960000
	});

	// Handle connections from clients.
	protooWebSocketServer.on('connectionrequest', (info, accept, reject) => {
		// The client indicates the roomId and peerId in the URL query.
		logger.info("request url:%s", info.request.url);
        if(!info.request.url) {
            reject(400, "request ulr is null");
            return;
        }
		const u = url.parse(info.request.url, true);
		const roomId = u.query['roomId'] as string;
		const peerId = u.query['peerId'] as string;
		const mode = u.query['mode'];

		if (!roomId || !peerId) {
			reject(400, 'Connection request without roomId and/or peerId');

			return;
		}

		logger.info(
			'protoo connection request [roomId:%s, peerId:%s, address:%s, origin:%s, mode:%s]',
			roomId, peerId, info.socket.remoteAddress, info.origin, mode);

		// Serialize this code into the queue to avoid that two peers connecting at
		// the same time with the same roomId create two separate rooms with same
		// roomId.
		queue.push(async () => {
				const room = await getOrCreateRoom(roomId);

				// Accept the protoo WebSocket connection.
				const protooWebSocketTransport = accept();

				room.handleProtooConnection({
					peerId,
					protooWebSocketTransport
				});
			})
			.catch((error) => {
				logger.error('room creation or room joining failed:%o', error);

				reject(error);
			});
	});
    return protooWebSocketServer;
}
