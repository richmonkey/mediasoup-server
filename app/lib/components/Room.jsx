import React from 'react';
import classnames from 'classnames';
import Me from './Me';
import Peer from './Peer';
import {
	ROOM_STATE_EVENT, 
	NEW_PEER_EVENT, 
	PEER_CLOSED_EVENT, 
	ADD_PRODUCER_EVENT, 
	REMOVE_PRODUCER_EVENT,
	PRODUCER_PAUSED_EVENT,
	PRODUCER_RESUMED_EVENT,
	REPLACE_PRODUCER_TRACK_EVENT,
	ADD_CONSUMER_EVENT,
	CONSUMER_CLOSED_EVENT,
	CONSUMER_PAUSED_EVENT,
	ACTIVE_SPEAKER_EVENT,
	CONSUMER_RESUMED_EVENT
} from "../RoomClient";

const Peers = ({ roomClient, peers, activeSpeakerId }) =>
{

	const onSetStatsPeerId = function()
	{

	};

	return (
		<div data-component='Peers'>
			{
				peers.map((peer) =>
				{

					const consumersArray = peer.consumers;
					const audioConsumer =
						consumersArray.find((consumer) => consumer.track.kind === 'audio');
					const videoConsumer =
						consumersArray.find((consumer) => consumer.track.kind === 'video');

					return (
						<div key={peer.id}>
							<div
								className={classnames('peer-container', {
									'active-speaker' : peer.id === activeSpeakerId
								})}
							>
								<Peer roomClient={roomClient} 
									peer={peer} 
									audioConsumer={audioConsumer} 
									videoConsumer={videoConsumer} 
									audioMuted={false} 
									faceDetection={false}
									onSetStatsPeerId={onSetStatsPeerId}
								/>
							</div>
						</div>
					);
				})
			}
		</div>
	);
};

export default class Room extends React.Component 
{
	constructor(props) 
	{
		super(props);
		this.onRoomState = this.onRoomState.bind(this);
		this.onNewPeer = this.onNewPeer.bind(this);
		this.onPeerClosed = this.onPeerClosed.bind(this);
		this.onAddProducer = this.onAddProducer.bind(this);
		this.onRemoveProducer = this.onRemoveProducer.bind(this);
		this.onReplaceProducerTrack = this.onReplaceProducerTrack.bind(this);
		this.onAddConsumer = this.onAddConsumer.bind(this);
		this.onConsumerClosed = this.onConsumerClosed.bind(this);
		this.onConsumerPaused = this.onConsumerPaused.bind(this);
		this.onConsumerResumed = this.onConsumerResumed.bind(this);

		this.state = {
			producers : [],
			peers     : []
		};
	}

	componentDidMount()
	{
		const { roomClient }	= this.props;

		roomClient.on(ROOM_STATE_EVENT, this.onRoomState);
		roomClient.on(NEW_PEER_EVENT, this.onNewPeer);
		roomClient.on(PEER_CLOSED_EVENT, this.onPeerClosed);
		roomClient.on(ADD_PRODUCER_EVENT, this.onAddProducer);
		roomClient.on(REMOVE_PRODUCER_EVENT, this.onRemoveProducer);
		roomClient.on(REPLACE_PRODUCER_TRACK_EVENT, this.onReplaceProducerTrack);
		roomClient.on(ADD_CONSUMER_EVENT, this.onAddConsumer);
		roomClient.on(CONSUMER_CLOSED_EVENT, this.onConsumerClosed);
		roomClient.on(CONSUMER_PAUSED_EVENT, this.onConsumerPaused);
		roomClient.on(CONSUMER_RESUMED_EVENT, this.onConsumerResumed);

		roomClient.join();
	}

	onRoomState(state) 
	{
		console.log("room state:", state);

		if (state == 'closed') 
		{
			this.setState({ peers:[], producers:[] });
		}
	}

	onNewPeer(peer) 
	{
		console.log("new peer:", peer);

		const old = this.state.peers.find(function(p) 
		{
			return (p.id == peer.id);
		});

		if (old) 
		{
			return;
		}

		this.state.peers.push(peer);
		this.setState({});
	}

	onPeerClosed(peerId) 
	{
		console.log("peer closed:", peerId);
		const index = this.state.peers.findIndex(function(p) 
		{
			return (p.id == peerId);
		});

		if (index == -1)
		{
			return;
		}

		this.state.peers.splice(index, 1);
		this.setState({});
	}

	onAddProducer(producer) 
	{
		console.log("add producer:", producer);
		this.state.producers.push(producer);
		this.setState({});
	}

	onRemoveProducer(producerId) 
	{
		console.log("remove producer:", producerId);

		const index = this.state.producers.findIndex(function(p) 
		{
			return p.id == producerId;
		});

		if (index == -1) 
		{
			return -1;
		}

		this.state.producers.splice(index, 1);
		this.setState({});
	}

	onReplaceProducerTrack(producerId, track) 
	{
		console.log("replace producer track", producerId, track);

		const index = this.state.producers.findIndex(function(p) 
		{
			return p.id == producerId;
		});

		if (index == -1) 
		{
			return -1;
		}

		const producer = this.state.producers[index];

		producer.track = track;
		this.setState({});
	}

	onAddConsumer(consumer, peerId) 
	{
		console.log("on add consumer:", consumer, peerId);

		const peer = this.state.peers.find(function(p)
		{
			return (p.id == peerId);
		});

		if (!peer) 
		{
			return;
		}

		peer.consumers.push(consumer);
		this.setState({});
	}

	onConsumerClosed(consumerId, peerId) 
	{
		console.log("on consumer closed:", consumerId);

		const peer = this.state.peers.find(function(p)
		{
			return (p.id == peerId);
		});

		if (!peer) 
		{
			return;
		}

		const index = peer.consumers.findIndex(function(c) 
		{
			return (c.id == consumerId);
		});

		if (index == -1) 
		{
			return;
		}

		peer.consumers.splice(index, 1);
		this.setState({});
	}

	onConsumerPaused(consumerId, peerId, originator) 
	{
		console.log("on consumer paused:", consumerId, originator);

		const peer = this.state.peers.find(function(p)
		{
			return (p.id == peerId);
		});

		if (!peer) 
		{
			return;
		}

		const index = peer.consumers.findIndex(function(c) 
		{
			return (c.id == consumerId);
		});

		if (index == -1) 
		{
			return;
		}

		peer.consumers[index].paused = true;
		this.setState({});
	}

	onConsumerResumed(consumerId, peerId, originator) 
	{
		console.log("on consumer resumed:", consumerId, originator);

		const peer = this.state.peers.find(function(p)
		{
			return (p.id == peerId);
		});

		if (!peer) 
		{
			return;
		}

		const index = peer.consumers.findIndex(function(c) 
		{
			return (c.id == consumerId);
		});

		if (index == -1) 
		{
			return;
		}

		peer.consumers[index].paused = false;
		this.setState({});
	}

	render()
	{
		const audioProducer = this.state.producers.find(function(p)
		{
			return p.track.kind == "audio";
		});

		const videoProducer = this.state.producers.find(function(p)
		{
			return p.track.kind == "video";
		});

		return (
			<div>
				<div data-component='Room'>
					<Peers roomClient={this.props.roomClient} 
						peers={this.state.peers}
					/>
					<div
						className={classnames('me-container', {
							'active-speaker' : true
						})}
					>
						<Me connected
							roomClient={this.props.roomClient} 
							me={this.props.roomClient._me} 
							audioProducer={audioProducer} 
							videoProducer={videoProducer}
						/>
					</div>
				</div>
			</div>
		);
	}
}
