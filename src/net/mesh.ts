// Direct connections between players: one WebRTC data channel per pair, set to unordered and
// without retransmission for the lowest latency. Setup messages go through the room. If a
// direct link cannot be made, packets for that player go through the room's relay instead.
import type { RoomClient } from './room-client.ts';
import { fromBase64, toBase64 } from './wire.ts';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];
const DIRECT_TIMEOUT_MS = 8_000;

export type LinkState = 'connecting' | 'direct' | 'relay';

interface Link {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  state: LinkState;
  timer: ReturnType<typeof setTimeout>;
}

export class Mesh {
  private links = new Map<number, Link>();
  onPacket: (data: ArrayBuffer) => void = () => {};
  onLinkChange: (seat: number, state: LinkState) => void = () => {};

  constructor(private room: RoomClient, private local: number, extraIce: RTCIceServer[] = []) {
    this.ice = [...ICE_SERVERS, ...extraIce];
  }

  private ice: RTCIceServer[];

  /** Opens links to every seat in `seats` that has none yet. The lower seat makes the offer. */
  ensure(seats: number[]): void {
    for (const s of seats) {
      if (s === this.local || this.links.has(s)) continue;
      this.open(s, this.local < s);
    }
  }

  state(seat: number): LinkState {
    return this.links.get(seat)?.state ?? 'connecting';
  }

  private open(seat: number, offer: boolean): Link {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const link: Link = {
      pc,
      channel: null,
      state: 'connecting',
      timer: setTimeout(() => this.fallBack(seat), DIRECT_TIMEOUT_MS),
    };
    this.links.set(seat, link);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.room.send({ type: 'signal', to: seat, data: JSON.stringify({ ice: e.candidate.toJSON() }) });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fallBack(seat);
    };
    const wire = (ch: RTCDataChannel) => {
      ch.binaryType = 'arraybuffer';
      link.channel = ch;
      ch.onopen = () => {
        clearTimeout(link.timer);
        link.state = 'direct';
        this.onLinkChange(seat, 'direct');
      };
      ch.onclose = () => this.fallBack(seat);
      ch.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.onPacket(e.data);
      };
    };
    if (offer) {
      wire(pc.createDataChannel('inputs', { ordered: false, maxRetransmits: 0 }));
      void pc
        .createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.room.send({ type: 'signal', to: seat, data: JSON.stringify({ sdp: pc.localDescription }) }));
    } else {
      pc.ondatachannel = (e) => wire(e.channel);
    }
    return link;
  }

  private fallBack(seat: number): void {
    const link = this.links.get(seat);
    if (!link || link.state === 'relay') return;
    if (link.state === 'direct' && link.channel?.readyState === 'open') return;
    clearTimeout(link.timer);
    link.state = 'relay';
    this.onLinkChange(seat, 'relay');
  }

  /** Handles a setup message from another seat, relayed by the room. */
  async signal(from: number, data: string): Promise<void> {
    let msg: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    let link = this.links.get(from);
    if (!link) link = this.open(from, false);
    const pc = link.pc;
    try {
      if (msg.sdp) {
        await pc.setRemoteDescription(msg.sdp);
        if (msg.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.room.send({ type: 'signal', to: from, data: JSON.stringify({ sdp: pc.localDescription }) });
        }
      } else if (msg.ice) {
        await pc.addIceCandidate(msg.ice);
      }
    } catch {
      // A failed step leaves the link to time out into the relay.
    }
  }

  /** Packets that came through the room's relay. */
  relayed(data: string): void {
    try {
      this.onPacket(fromBase64(data));
    } catch {
      // Ignore malformed relay data.
    }
  }

  send(seat: number, data: ArrayBuffer): void {
    const link = this.links.get(seat);
    if (link && link.state === 'direct' && link.channel && link.channel.readyState === 'open') {
      try {
        link.channel.send(data);
        return;
      } catch {
        // Fall through to the relay.
      }
    }
    if (link && link.state === 'relay') this.room.send({ type: 'relay', to: seat, data: toBase64(data) });
  }

  close(): void {
    for (const l of this.links.values()) {
      clearTimeout(l.timer);
      l.pc.close();
    }
    this.links.clear();
  }
}
