#!/usr/bin/env node

process.title = 'mediasoup-groupcall-server';
//process.env.DEBUG = process.env.DEBUG || '*INFO* *WARN* *ERROR*';
process.env.DEBUG = process.env.DEBUG || '*mediasoup* *INFO* *WARN* *ERROR*';
//DEBUG=${DEBUG:='*server* *mediasoup* *Room* *InterphoneRoom* *INFO* *WARN* *ERROR*'} 


import * as https from "node:https";
import * as http from "node:http";
import * as protoo from "protoo-server";
import * as mediasoup from "mediasoup";
import { AwaitQueue } from "awaitqueue";
import config from "./config";
import Room from "./Room";
import { runHttpServer, runMediasoupWorkers, runProtooWebSocketServer } from "./server";


console.log('process.env.DEBUG:', process.env.DEBUG);
console.log('config.js:\n%s', JSON.stringify(config, null, '  '));

const logger = console;



class Server {

    // Map of Room instances indexed by roomId.
    rooms = new Map<string, Room>();

    // mediasoup Workers.
    mediasoupWorkers: mediasoup.types.Worker[] = [];

    // Index of next mediasoup Worker to use.
    nextMediasoupWorkerIdx = 0;

    constructor() {

    }


    /**
     * Get next mediasoup Worker.
     */
    getMediasoupWorker() {
        const worker = this.mediasoupWorkers[this.nextMediasoupWorkerIdx];

        if (++this.nextMediasoupWorkerIdx === this.mediasoupWorkers.length)
            this.nextMediasoupWorkerIdx = 0;

        return worker;
    }

    /**
     * Get a Room instance (or create one if it does not exist).
     */
    async getOrCreateRoom(roomId: string) {
        let room = this.rooms.get(roomId);

        // If the Room does not exist create a new one.
        if (!room) {
            logger.info('creating a new Room [roomId:%s]', roomId);
            const mediasoupWorker = this.getMediasoupWorker();
            room = await Room.create(mediasoupWorker, roomId);
            this.rooms.set(roomId, room);
            room.on('close', () => this.rooms.delete(roomId));
        }

        return room;
    }

    async runMediasoupWorkers() {
        this.mediasoupWorkers = await runMediasoupWorkers();
    }

    closeAllRooms() {
        for (const room of this.rooms.values()) {
            room.close();
        }
        this.rooms.clear();
    }

    closeAllWorkers() {
        for (const worker of this.mediasoupWorkers) {
            worker.close();
        }
        this.mediasoupWorkers = [];
    }

}

async function main() {
    // Async queue to manage rooms.
    const queue = new AwaitQueue();
    let httpServer: http.Server | undefined;
    // Protoo WebSocket server.
    let wsServer: protoo.WebSocketServer | undefined;
    let statusTimer: NodeJS.Timeout | undefined;
    let shuttingDown = false;

    const server = new Server();

    const shutdown = async (signal: string) => {
        if (shuttingDown) {
            logger.warn('shutdown already in progress, forcing exit [signal:%s]', signal);
            process.exit(1);
            return;
        }

        shuttingDown = true;
        logger.info('received %s, shutting down...', signal);

        const forceExitTimer = setTimeout(() => {
            logger.error('force exiting after shutdown timeout');
            process.exit(1);
        }, 2000);
        forceExitTimer.unref();

        try {
            if (statusTimer) {
                clearInterval(statusTimer);
                statusTimer = undefined;
            }

            // Stop accepting new WebSocket connections first.
            wsServer?.stop();
            wsServer = undefined;

            // Close rooms and mediasoup resources.
            server.closeAllRooms();
            server.closeAllWorkers();

            if (httpServer) {
                (httpServer as any).closeIdleConnections?.();
                (httpServer as any).closeAllConnections?.();

                await new Promise<void>((resolve) => {
                    httpServer!.close(() => resolve());
                });
                httpServer = undefined;
            }

            clearTimeout(forceExitTimer);
            process.exit(0);
        } catch (error) {
            logger.error('shutdown failed:%o', error);
            clearTimeout(forceExitTimer);
            process.exit(1);
        }
    };

    process.once('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
    });

    // Run a mediasoup Worker.
    await server.runMediasoupWorkers();

    httpServer = await runHttpServer();
    wsServer = await runProtooWebSocketServer(httpServer, queue, server.getOrCreateRoom.bind(server));

    // Log rooms status every X seconds.
    statusTimer = setInterval(() => {
        for (const room of server.rooms.values()) {
            room.logStatus();
        }
    }, 120000);
    statusTimer.unref();
}

main();