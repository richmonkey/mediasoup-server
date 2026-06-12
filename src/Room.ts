import { EventEmitter } from 'node:events';
import * as protoo from "protoo-server";
import * as mediasoup from 'mediasoup';

import config from "./config";

const ENABLE_AUTH = config.auth.enabled;
const ENABLE_AUDIO_LEVEL_OBSERVER = false;

const logger = console;

interface PeerData {
    joined: boolean;
    leaved: boolean;
    present: boolean;
    displayName?: string;
    device: any;
    authed: boolean;
    rtpCapabilities?: mediasoup.types.RtpCapabilities;
    sctpCapabilities?: {
        numStreams?: {
            OS: number;
            MIS: number;
        };
    };
    transports: Map<string, mediasoup.types.WebRtcTransport>;
    producers: Map<string, mediasoup.types.Producer>;
    consumers: Map<string, mediasoup.types.Consumer>;
    dataProducers: Map<string, mediasoup.types.DataProducer>;
    dataConsumers: Map<string, mediasoup.types.DataConsumer>;
}

interface ProtooPeer extends protoo.Peer {
    data: PeerData;
}

type HandlerFunction = (peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) => Promise<void>;
type Handler = { handler: HandlerFunction, requireAuth: boolean, requireJoin: boolean };

/**
 * Room class.
 *
 * This is not a "mediasoup Room" by itself, by a custom class that holds
 * a protoo Room (for signaling with WebSocket clients) and a mediasoup Router
 * (for sending and receiving media to/from those WebSocket peers).
 */
export default class Room extends EventEmitter<{ close: [] }> {
    _mediasoupRouter: mediasoup.types.Router;
    _protooRoom: protoo.Room;
    _roomId: string;
    _closed: boolean;
    _creating: boolean;
    _audioLevelObserver: mediasoup.types.AudioLevelObserver;
    _consumerPeers: Map<string, ProtooPeer>;
    _handlers: Map<string, HandlerFunction | Handler> = new Map();


    /**
     * Factory function that creates and returns Room instance.
     *
     * @async
     *
     * @param {mediasoup.Worker} mediasoupWorker - The mediasoup Worker in which a new
     *   mediasoup Router must be created.
     * @param {String} roomId - Id of the Room instance.
     */
    static async create(mediasoupWorker: mediasoup.types.Worker, roomId: string) {
        logger.info('create() [roomId:%s]', roomId);

        // Create a protoo Room instance.
        const protooRoom = new protoo.Room();

        // Router media codecs.
        const { mediaCodecs } = config.mediasoup.routerOptions;

        // Create a mediasoup Router.
        const mediasoupRouter = await mediasoupWorker.createRouter({ mediaCodecs });

        // Create a mediasoup AudioLevelObserver.
        const audioLevelObserver = await mediasoupRouter.createAudioLevelObserver({
            maxEntries: 1,
            threshold: -80,
            interval: 800
        });

        return new Room(roomId, protooRoom, mediasoupRouter, audioLevelObserver);
    }

    constructor(roomId: string,
        protooRoom: protoo.Room,
        mediasoupRouter: mediasoup.types.Router,
        audioLevelObserver: mediasoup.types.AudioLevelObserver) {
        super();
        this.setMaxListeners(Infinity);

        // Room id.
        this._roomId = roomId;

        // Closed flag.
        this._closed = false;

        // protoo Room instance.
        this._protooRoom = protooRoom;

        // mediasoup Router instance.
        this._mediasoupRouter = mediasoupRouter;

        // mediasoup AudioLevelObserver.
        this._audioLevelObserver = audioLevelObserver;

        //避免existingPeer是最后一个peer，导致room被close
        this._creating = false;

        this._consumerPeers = new Map();

        this._handlers = new Map();
        this._handlers.set('getRouterRtpCapabilities', { handler: this._handleGetRouterRtpCapabilities, requireAuth: false, requireJoin: false });
        this._handlers.set('auth', { handler: this._handleAuth, requireAuth: false, requireJoin: false });
        this._handlers.set('join', { handler: this._handleJoin, requireAuth: true, requireJoin: false });
        this._handlers.set('createWebRtcTransport', { handler: this._handleCreateWebRtcTransport, requireAuth: true, requireJoin: false });
        this._handlers.set('connectWebRtcTransport', { handler: this._handleConnectWebRtcTransport, requireAuth: true, requireJoin: false });
        this._handlers.set('restartIce', { handler: this._handleRestartIce, requireAuth: true, requireJoin: true });
        this._handlers.set('produce', { handler: this._handleProduce, requireAuth: true, requireJoin: true });
        this._handlers.set('closeProducer', { handler: this._handleCloseProducer, requireAuth: true, requireJoin: true });
        this._handlers.set('pauseProducer', this._handlePauseProducer);
        this._handlers.set('resumeProducer', this._handleResumeProducer);
        this._handlers.set('consume', this._handleConsume);
        this._handlers.set('closeConsumer', this._handleCloseConsumer);
        this._handlers.set('pauseConsumer', this._handlePauseConsumer);
        this._handlers.set('resumeConsumer', this._handleResumeConsumer);
        this._handlers.set('setConsumerPreferredLayers', this._handleSetConsumerPreferredLayers);
        this._handlers.set('setConsumerPriority', this._handleSetConsumerPriority);
        this._handlers.set('requestConsumerKeyFrame', this._handleRequestConsumerKeyFrame);
        this._handlers.set('getTransportStats', this._handleGetTransportStats);
        this._handlers.set('getProducerStats', this._handleGetProducerStats);
        this._handlers.set('getConsumerStats', this._handleGetConsumerStats);
        this._handlers.set('changeDisplayName', this._handleChangeDisplayName);
        this._handlers.set('transferPeerMessage', this._handleTransferPeerMessage);
        this._handlers.set('broadcastMessage', this._handleBroadcastMessage);
        this._handlers.set('joinConference', this._handleJoinConference);
        this._handlers.set('leaveConference', this._handleLeaveConference);

        this._mediasoupRouter.observer.on("close", () => {
            logger.debug("router closed");
        })

        // Handle audioLevelObserver. lots of logs
        if (ENABLE_AUDIO_LEVEL_OBSERVER) {
            this._handleAudioLevelObserver();
        }

        logger.info("router rtp cap:", this._mediasoupRouter.rtpCapabilities);
    }

    /**
     * Closes the Room instance by closing the protoo Room and the mediasoup Router.
     */
    close() {
        logger.debug('close()');

        this._closed = true;

        // Close the protoo Room.
        this._protooRoom.close();

        // Close the mediasoup Router.
        this._mediasoupRouter.close();

        // Emit 'close' event.
        this.emit('close');
    }

    logStatus() {
        logger.info(
            'logStatus() [roomId:%s, protoo Peers:%s]',
            this._roomId,
            this._protooRoom.peers.length);
    }

    /**
     * Called from server.js upon a protoo WebSocket connection request from a
     * browser.
     *
     * @param {String} peerId - The id of the protoo peer to be created.
     * @param {Boolean} consume - Whether this peer wants to consume from others.
     * @param {protoo.WebSocketTransport} protooWebSocketTransport - The associated
     *   protoo WebSocket transport.
     */
    handleProtooConnection({
        peerId,
        protooWebSocketTransport
    }: { peerId: string, protooWebSocketTransport: protoo.WebSocketTransport }) {
        const existingPeer = this._protooRoom.getPeer(peerId);

        this._creating = true;

        if (existingPeer) {
            logger.warn(
                'handleProtooConnection() | there is already a protoo Peer with same peerId, closing it [peerId:%s]',
                peerId);
            existingPeer.close();
        }

        let peer: protoo.Peer;
        // Create a new protoo Peer with the given peerId.
        try {
            // mistake typescript declaration
            peer = this._protooRoom.createPeer(peerId, protooWebSocketTransport) as any as protoo.Peer;
        } catch (error) {
            logger.error('protooRoom.createPeer() failed:%o', error);
            return;
        }

        this._creating = false;

        // Use the peer.data object to store mediasoup related objects.

        // Not joined after a custom protoo 'join' request is later received.
        //状态时序， (joined:false, leaved:false) -> (joined:true, leaved:false) -> (joined:true, leaved:true)
        let peerData: PeerData = peer.data;

        peerData.authed = !ENABLE_AUTH;
        peerData.joined = false;
        peerData.leaved = false;
        peerData.present = false;
        peerData.displayName = undefined;
        peerData.device = undefined;
        peerData.rtpCapabilities = undefined;
        peerData.sctpCapabilities = undefined;

        // Have mediasoup related maps ready even before the Peer joins since we
        // allow creating Transports before joining.
        peerData.transports = new Map();
        peerData.producers = new Map();
        peerData.consumers = new Map();
        peerData.dataProducers = new Map();
        peerData.dataConsumers = new Map();

        peer.on('request', (request, accept, reject) => {
            logger.debug(
                'protoo Peer "request" event [method:%s, peerId:%s]',
                request.method, peer.id);

            this._handleProtooRequest(peer, request, accept, reject)
                .catch((error) => {
                    logger.error('request failed:%o', error);

                    reject(error);
                });
        });

        peer.on("notification", (notification) => {
            logger.debug(
                'protoo Peer "notification" event [method:%s, data:%o]',
                notification.method, notification.data);
            switch (notification.method) {
                case "leave":
                    peer.data.leaved = true;
                    break;
                case 'ping':
                    peer.notify('pong', {})
                        .catch(() => { });
                    break;
                default:
                    break;
            }
        });

        peer.on('close', () => {
            this._handlePeerClosed(peer);
        });
    }

    _handleAudioLevelObserver() {
        this._audioLevelObserver.on('volumes', (volumes) => {
            const {
                producer,
                volume
            } = volumes[0];

            logger.debug(
                'audioLevelObserver "volumes" event [producerId:%s, volume:%s]',
                producer.id, volume);

            // Notify all Peers.
            for (const peer of this._getJoinedPeers()) {
                peer.notify(
                    'activeSpeaker',
                    {
                        peerId: producer.appData.peerId,
                        volume: volume
                    })
                    .catch(() => { });
            }

        });

        this._audioLevelObserver.on('silence', () => {
            logger.debug('audioLevelObserver "silence" event');

            // Notify all Peers.
            for (const peer of this._getJoinedPeers()) {
                peer.notify('activeSpeaker', {
                    peerId: null
                })
                    .catch(() => { });
            }
        });
    }

    _handlePeerClosed(peer: ProtooPeer) {
        if (this._closed)
            return;

        logger.debug('protoo Peer "close" event [peerId:%s]', peer.id);
        // If the Peer was joined, notify all Peers.
        if (peer.data.joined) {
            for (const otherPeer of this._getJoinedPeers(peer)) {
                otherPeer.notify('peerClosed', { peerId: peer.id })
                    .catch(() => { });
            }
        }

        // Iterate and close all mediasoup Transport associated to this Peer, so all
        // its Producers and Consumers will also be closed.
        for (const transport of peer.data.transports.values()) {
            transport.close();
        }

        // If this is the latest Peer in the room, close the room.
        if (this._protooRoom.peers.length === 0 && !this._creating) {
            logger.info(
                'last Peer in the room left, closing the room [roomId:%s]',
                this._roomId);

            this.close();
        }
    }

    async _handleAuth(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            token
        } = request.data;
        const key = "access_token_" + token;

        if (!ENABLE_AUTH) {
            accept(undefined);
            return;
        }
        //TODO support auth.
        peer.data.authed = true;
        accept(undefined);

        // console.log("redis hget:", key, "  user_id");
        // this._redisClient.hget(key, "user_id", (err, result) => {
        // 	console.log("redis hget result:", err, result);
        // 	if (err) reject(400, err);
        // 	if (result != peer.id) {
        // 		reject(400, new Error("invalid token"));
        // 	} else {
        // 		peer.data.authed = true;
        // 		accept();
        // 	}
        // });
    }

    async _handleGetRouterRtpCapabilities(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        accept(this._mediasoupRouter.rtpCapabilities);
    }

    async _handleConnectWebRtcTransport(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            transportId,
            dtlsParameters
        } = request.data;
        const transport = peer.data.transports.get(transportId);

        if (!transport)
            throw new Error(`transport with id "${transportId}" not found`);

        await transport.connect({
            dtlsParameters
        });

        accept(undefined);
    }

    async _handleRestartIce(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            transportId
        } = request.data;
        const transport = peer.data.transports.get(transportId);

        if (!transport)
            throw new Error(`transport with id "${transportId}" not found`);

        const iceParameters = await transport.restartIce();

        accept(iceParameters);

    }

    async _handleCloseProducer(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            producerId
        } = request.data;
        const producer = peer.data.producers.get(producerId);

        if (!producer)
            throw new Error(`producer with id "${producerId}" not found`);

        producer.close();

        // Remove from its map.
        peer.data.producers.delete(producer.id);

        accept(undefined);
    }

    async _handlePauseProducer(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        // Ensure the Peer is joined.
        if (!peer.data.joined)
            throw new Error('Peer not yet joined');

        const {
            producerId
        } = request.data;
        const producer = peer.data.producers.get(producerId);

        if (!producer)
            throw new Error(`producer with id "${producerId}" not found`);

        await producer.pause();

        accept(undefined);
    }

    async _handleResumeProducer(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            producerId
        } = request.data;
        const producer = peer.data.producers.get(producerId);

        if (!producer)
            throw new Error(`producer with id "${producerId}" not found`);

        await producer.resume();

        accept(undefined);
    }

    async _handleConsume(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            producerId,
            transportId
        } = request.data;

        logger.debug('consume:', producerId, transportId);


        // Optimization:
        // - Create the server-side Consumer in paused mode.
        // - Tell its Peer about it and wait for its response.
        // - Upon receipt of the response, resume the server-side Consumer.
        // - If video, this will mean a single key frame requested by the
        //   server-side Consumer (when resuming it).
        // - If audio (or video), it will avoid that RTP packets are received by the
        //   remote endpoint *before* the Consumer is locally created in the endpoint
        //   (and before the local SDP O/A procedure ends). If that happens (RTP
        //   packets are received before the SDP O/A is done) the PeerConnection may
        //   fail to associate the RTP stream.

        // NOTE: Don't create the Consumer if the remote Peer cannot consume it.
        if (
            !peer.data.rtpCapabilities ||
            !this._mediasoupRouter.canConsume({
                producerId: producerId,
                rtpCapabilities: peer.data.rtpCapabilities
            })
        ) {
            return;
        }

        const transport = peer.data.transports.get(transportId);

        // This should not happen.
        if (!transport || !transport.appData.consuming) {
            logger.warn('_createConsumer() | Transport for consuming not found');

            return;
        }

        // Create the Consumer in paused mode.
        let consumer: mediasoup.types.Consumer;

        try {
            consumer = await transport.consume({
                producerId: producerId,
                rtpCapabilities: peer.data.rtpCapabilities,
                paused: true
            });
        } catch (error) {
            logger.warn('_createConsumer() | transport.consume():%o', error);

            return;
        }

        // Store the Consumer into the protoo consumerPeer data Object.
        peer.data.consumers.set(consumer.id, consumer);
        this._consumerPeers.set(consumer.id, peer);

        this._handleConsumer(consumer);

        accept({
            id: consumer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            type: consumer.type,
            producerPaused: consumer.producerPaused,
            producerId: producerId,
        });
    }

    async _handleCloseConsumer(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            consumerId
        } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
            throw new Error(`consumer with id "${consumerId}" not found`);

        consumer.close();

        accept(undefined);

    }

    async _handlePauseConsumer(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            consumerId
        } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
            throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.pause();

        accept(undefined);
    }

    async _handleResumeConsumer(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            consumerId
        } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
            throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.resume();

        accept(undefined);
    }

    async _handleSetConsumerPreferredLayers(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            consumerId,
            spatialLayer,
            temporalLayer
        } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
            throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.setPreferredLayers({
            spatialLayer,
            temporalLayer
        });

        accept(undefined);
    }


    async _handleSetConsumerPriority(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            consumerId,
            priority
        } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
            throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.setPriority(priority);

        accept(undefined);
    }


    async _handleRequestConsumerKeyFrame(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            consumerId
        } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
            throw new Error(`consumer with id "${consumerId}" not found`);

        await consumer.requestKeyFrame();

        accept(undefined);
    }

    async _handleChangeDisplayName(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            displayName
        } = request.data;
        const oldDisplayName = peer.data.displayName;

        // Store the display name into the custom data Object of the protoo
        // Peer.
        peer.data.displayName = displayName;

        // Notify other joined Peers.
        for (const otherPeer of this._getJoinedPeers(peer)) {
            otherPeer.notify(
                'peerDisplayNameChanged', {
                peerId: peer.id,
                displayName,
                oldDisplayName
            })
                .catch(() => { });
        }

        accept(undefined);
    }

    async _handleGetTransportStats(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            transportId
        } = request.data;
        const transport = peer.data.transports.get(transportId);

        if (!transport)
            throw new Error(`transport with id "${transportId}" not found`);

        const stats = await transport.getStats();

        accept(stats);
    }

    async _handleGetProducerStats(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            producerId
        } = request.data;
        const producer = peer.data.producers.get(producerId);

        if (!producer)
            throw new Error(`producer with id "${producerId}" not found`);

        const stats = await producer.getStats();

        accept(stats);
    }

    async _handleGetConsumerStats(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            consumerId
        } = request.data;
        const consumer = peer.data.consumers.get(consumerId);

        if (!consumer)
            throw new Error(`consumer with id "${consumerId}" not found`);

        const stats = await consumer.getStats();

        accept(stats);
    }

    async _handleGetDataProdocuerStats(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            dataProducerId
        } = request.data;
        const dataProducer = peer.data.dataProducers.get(dataProducerId);

        if (!dataProducer)
            throw new Error(`dataProducer with id "${dataProducerId}" not found`);

        const stats = await dataProducer.getStats();

        accept(stats);

    }

    async _handleGetDataConsumerStats(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const {
            dataConsumerId
        } = request.data;
        const dataConsumer = peer.data.dataConsumers.get(dataConsumerId);

        if (!dataConsumer)
            throw new Error(`dataConsumer with id "${dataConsumerId}" not found`);

        const stats = await dataConsumer.getStats();

        accept(stats);

    }

    async _handleTransferPeerMessage(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const m = request.data;
        accept({});

        const msg = Object.assign({}, m, {
            sender: peer.id
        });

        const otherPeer = this._protooRoom.peers
            .find((peer) => peer.data.joined && peer.id == m.receiver);

        if (otherPeer) {
            otherPeer.notify('newPeerMessage', msg)
                .catch(() => { });
        }

    }

    async _handleBroadcastMessage(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        const m = request.data;
        accept({});

        const msg = Object.assign({}, m, {
            sender: peer.id
        });
        const sender = peer.id;
        const peers = this._protooRoom.peers
            .filter((peer) => peer.data.joined && peer.id != sender);

        peers.forEach((otherPeer) => {
            otherPeer.notify('newPeerMessage', msg)
                .catch(() => { });
        });

    }

    async _handleJoinConference(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        logger.debug("peer:%s join conference", peer.id);
        peer.data.present = true;
        accept(undefined);

        for (const otherPeer of this._getJoinedPeers(peer)) {
            otherPeer.notify('newMember', {
                peerId: peer.id
            })
                .catch(() => { });
        }
    }

    async _handleLeaveConference(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        logger.debug("peer:%s leave conference", peer.id);
        peer.data.present = false;
        accept(undefined);

        for (const otherPeer of this._getJoinedPeers(peer)) {
            otherPeer.notify('memberLeft', {
                peerId: peer.id
            })
                .catch(() => { });
        }
    }
    //request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn
    async _handleJoin(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        // Ensure the Peer is not already joined.
        if (peer.data.joined)
            throw new Error('Peer already joined');

        const {
            displayName,
            device,
            rtpCapabilities,
            sctpCapabilities
        } = request.data;



        // Store client data into the protoo Peer data object.
        peer.data.displayName = displayName;
        peer.data.device = device;
        peer.data.rtpCapabilities = rtpCapabilities;
        peer.data.sctpCapabilities = sctpCapabilities;

        // Tell the new Peer about already joined Peers.
        const joinedPeers = [
            ...this._getJoinedPeers()
        ];
        const peersInfo = this.getPeersInfo(peer, joinedPeers);

        accept({
            peers: peersInfo,
        });

        // Mark the new Peer as joined.
        peer.data.joined = true;

        // Notify the new Peer to all other Peers.
        for (const otherPeer of this._getJoinedPeers(peer)) {
            otherPeer.notify(
                'newPeer', {
                id: peer.id,
                displayName: peer.data.displayName,
                device: peer.data.device,
                present: peer.data.present
            })
                .catch(() => { });
        }

    }

    async _handleCreateWebRtcTransport(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        // NOTE: Don't require that the Peer is joined here, so the client can
        // initiate mediasoup Transports and be ready when he later joins.

        const {
            forceTcp,
            producing,
            consuming,
            sctpCapabilities
        } = request.data;

        const webRtcTransportOptions: mediasoup.types.WebRtcTransportOptions = {
            ...config.mediasoup.webRtcTransportOptions,
            enableSctp: Boolean(sctpCapabilities),
            appData: {
                producing,
                consuming
            }
        };

        if (forceTcp) {
            webRtcTransportOptions.enableUdp = false;
            webRtcTransportOptions.enableTcp = true;
        }

        const transport = await this._mediasoupRouter.createWebRtcTransport(
            webRtcTransportOptions);

        transport.on('sctpstatechange', (sctpState) => {
            logger.debug('WebRtcTransport "sctpstatechange" event [sctpState:%s]', sctpState);
        });

        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'failed' || dtlsState === 'closed')
                logger.warn('WebRtcTransport "dtlsstatechange" event [dtlsState:%s]', dtlsState);
        });

        // NOTE: For testing.
        // await transport.enableTraceEvent([ 'probation', 'bwe' ]);
        //await transport.enableTraceEvent([ 'bwe' ]);

        transport.on('trace', (trace) => {

            logger.debug(
                'transport "trace" event [transportId:%s, trace.type:%s, trace:%o]',
                transport.id, trace.type, trace);

            if (trace.type === 'bwe' && trace.direction === 'out') {
                const info = trace.info as Partial<{
                    desiredBitrate: number;
                    effectiveDesiredBitrate: number;
                    availableBitrate: number;
                }>;

                peer.notify(
                    'downlinkBwe', {
                    desiredBitrate: info.desiredBitrate,
                    effectiveDesiredBitrate: info.effectiveDesiredBitrate,
                    availableBitrate: info.availableBitrate
                })
                    .catch(() => { });
            }
        });

        // Store the WebRtcTransport into the protoo Peer data Object.
        peer.data.transports.set(transport.id, transport);

        accept({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            sctpParameters: transport.sctpParameters
        });

        const {
            maxIncomingBitrate
        } = config.mediasoup.webRtcTransportOptions;

        // If set, apply max incoming bitrate limit.
        if (maxIncomingBitrate) {
            try {
                await transport.setMaxIncomingBitrate(maxIncomingBitrate);
            } catch (error) {
                console.log("error:", error);
            }
        }
    }

    async _handleProduce(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        // Ensure the Peer is joined.
        if (!peer.data.joined)
            throw new Error('Peer not yet joined');
        if (!peer.data.authed)
            throw new Error('Peer not yet authed');

        const {
            transportId,
            kind,
            rtpParameters
        } = request.data;
        let {
            appData
        } = request.data;
        const transport = peer.data.transports.get(transportId);

        if (!transport)
            throw new Error(`transport with id "${transportId}" not found`);

        // Add peerId into appData to later get the associated Peer during
        // the 'loudest' event of the audioLevelObserver.
        appData = {
            ...appData,
            peerId: peer.id
        };

        const producer = await transport.produce({
            kind,
            rtpParameters,
            appData
            // keyFrameRequestDelay: 5000
        });

        logger.debug("produce:", producer.id, producer.type);

        // Store the Producer into the protoo Peer data Object.
        peer.data.producers.set(producer.id, producer);

        // Set Producer events.
        producer.on('score', (score) => {
            // logger.debug(
            //      'producer "score" event [producerId:%s, score:%o]',
            //      producer.id, score);

            peer.notify('producerScore', {
                producerId: producer.id,
                score
            })
                .catch(() => { });
        });

        producer.on('videoorientationchange', (videoOrientation) => {
            logger.debug(
                'producer "videoorientationchange" event [producerId:%s, videoOrientation:%o]',
                producer.id, videoOrientation);
        });

        // NOTE: For testing.
        // await producer.enableTraceEvent([ 'rtp', 'keyframe', 'nack', 'pli', 'fir' ]);
        // await producer.enableTraceEvent([ 'pli', 'fir' ]);
        // await producer.enableTraceEvent([ 'keyframe' ]);

        producer.on('trace', (trace) => {
            logger.debug(
                'producer "trace" event [producerId:%s, trace.type:%s, trace:%o]',
                producer.id, trace.type, trace);
        });

        accept({
            id: producer.id
        });

        // Add into the audioLevelObserver.
        if (producer.kind === 'audio') {
            this._audioLevelObserver.addProducer({
                producerId: producer.id
            })
                .catch(() => { });
        }

        for (const otherPeer of this._getJoinedPeers(peer)) {
            otherPeer.notify(
                'newProducer', {
                id: producer.id,
                kind: producer.kind,
                peerId: peer.id
            })
                .catch(() => { });
        }
    }

    /**
     * Handle protoo requests from browsers.
     *
     * @async
     */
    async _handleProtooRequest(peer: ProtooPeer, request: protoo.ProtooRequest, accept: protoo.AcceptFn, reject: protoo.RejectFn) {
        let handler = this._handlers.get(request.method);
        if (!handler) {
            logger.error('unknown request.method "%s"', request.method);

            reject(500, `unknown request.method "${request.method}"`);
            return;
        }

        let methodHander: Handler;
        if ("handler" in handler) {
            methodHander = handler as Handler;
        } else {
            methodHander = { handler: handler as HandlerFunction, requireAuth: true, requireJoin: true };
        }
        if (methodHander.requireAuth && !peer.data.authed) {
            throw new Error('Peer not yet authed');
        }
        if (methodHander.requireJoin && !peer.data.joined) {
            throw new Error('Peer not yet joined');
        }

        await methodHander.handler.apply(this, [peer, request, accept, reject]);
    }

    getPeersInfo(peer: ProtooPeer, joinedPeers: ProtooPeer[]) {
        // Reply now the request with the list of joined peers (all but the new one).
        const peerInfos = joinedPeers
            .filter((joinedPeer) => joinedPeer.id !== peer.id)
            .map((joinedPeer) => {
                var producers = Array.from(joinedPeer.data.producers.values()).map((p) => {
                    return {
                        id: p.id,
                        kind: p.kind
                    };
                });
                var dataProducers = Array.from(joinedPeer.data.dataProducers.values()).map((p) => {
                    return p.id;
                });
                return {
                    id: joinedPeer.id,
                    displayName: joinedPeer.data.displayName,
                    device: joinedPeer.data.device,
                    present: joinedPeer.data.present,
                    producers: producers,
                    dataProducers: dataProducers
                }
            });
        return peerInfos;
    }

    /**
     * Helper to get the list of joined protoo peers.
     */
    _getJoinedPeers(excludePeer?: ProtooPeer) {
        let peers = this._protooRoom.peers as ProtooPeer[];
        return peers.filter((peer) => peer.data.joined && peer !== excludePeer);
    }

    _handleConsumer(consumer: mediasoup.types.Consumer) {
        // Set Consumer events.
        consumer.on('transportclose', () => {
            let consumerPeer = this._consumerPeers.get(consumer.id);
            if (!consumerPeer) {
                logger.warn("can't find consumer peer, consumer id:", consumer.id);
                return;
            }
            // Remove from its map.
            consumerPeer.data.consumers.delete(consumer.id);
            this._consumerPeers.delete(consumer.id);
        });

        consumer.on('producerclose', () => {
            let consumerPeer = this._consumerPeers.get(consumer.id);
            if (!consumerPeer) {
                logger.warn("can't find consumer peer, consumer id:", consumer.id);
                return;
            }
            // Remove from its map.
            consumerPeer.data.consumers.delete(consumer.id);
            this._consumerPeers.delete(consumer.id);

            consumerPeer.notify('consumerClosed', {
                consumerId: consumer.id
            })
                .catch(() => { });
        });

        consumer.on('producerpause', () => {
            let consumerPeer = this._consumerPeers.get(consumer.id);
            if (!consumerPeer) {
                logger.warn("can't find consumer peer, consumer id:", consumer.id);
                return;
            }
            consumerPeer.notify('consumerPaused', {
                consumerId: consumer.id
            })
                .catch(() => { });
        });

        consumer.on('producerresume', () => {
            let consumerPeer = this._consumerPeers.get(consumer.id);
            if (!consumerPeer) {
                logger.warn("can't find consumer peer, consumer id:", consumer.id);
                return;
            }
            consumerPeer.notify('consumerResumed', {
                consumerId: consumer.id
            })
                .catch(() => { });
        });

        consumer.on('score', (score) => {
            // logger.debug(
            //      'consumer "score" event [consumerId:%s, score:%o]',
            //      consumer.id, score);
            let consumerPeer = this._consumerPeers.get(consumer.id);
            if (!consumerPeer) {
                logger.warn("can't find consumer peer, consumer id:", consumer.id);
                return;
            }
            consumerPeer.notify('consumerScore', {
                consumerId: consumer.id,
                score
            })
                .catch(() => { });
        });

        consumer.on('layerschange', (layers) => {
            let consumerPeer = this._consumerPeers.get(consumer.id);
            if (!consumerPeer) {
                logger.warn("can't find consumer peer, consumer id:", consumer.id);
                return;
            }
            consumerPeer.notify(
                'consumerLayersChanged', {
                consumerId: consumer.id,
                spatialLayer: layers ? layers.spatialLayer : null,
                temporalLayer: layers ? layers.temporalLayer : null
            })
                .catch(() => { });
        });

        // NOTE: For testing.
        // await consumer.enableTraceEvent([ 'rtp', 'keyframe', 'nack', 'pli', 'fir' ]);
        // await consumer.enableTraceEvent([ 'pli', 'fir' ]);
        // await consumer.enableTraceEvent([ 'keyframe' ]);

        consumer.on('trace', (trace) => {
            logger.debug(
                'consumer "trace" event [producerId:%s, trace.type:%s, trace:%o]',
                consumer.id, trace.type, trace);
        });
    }
}


