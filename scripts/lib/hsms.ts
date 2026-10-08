/**
 * A minimal SECS/GEM host over HSMS single-session (TCP). Enough to run a fab: establish communication,
 * go online, read status variables, send remote commands. Written for this repo, not a general library.
 *
 * Framing: a 4 byte big-endian length, then a 10 byte header (session id, header byte 2 with the W bit
 * and stream, header byte 3 with the function, PType 0, SType, 4 system bytes), then the SECS-II body.
 * Items: a format byte holding the format code and the number of length bytes, then the length, then the data.
 * See docs/VERIFICATION.md for the public sources.
 */
import net from "node:net";

export type Item =
  | { t: "L"; v: Item[] }
  | { t: "A"; v: string }
  | { t: "B"; v: number[] }
  | { t: "U1" | "U2" | "U4" | "I4" | "F4" | "F8"; v: number }
  | { t: "BOOLEAN"; v: boolean };

const CODE = { L: 0, B: 0o10, BOOLEAN: 0o11, A: 0o20, F8: 0o40, F4: 0o44, I4: 0o34, U1: 0o51, U2: 0o52, U4: 0o54 } as const;
const NAME = new Map<number, keyof typeof CODE>(Object.entries(CODE).map(([k, v]) => [v, k as keyof typeof CODE]));

export const L = (...v: Item[]): Item => ({ t: "L", v });
export const A = (v: string): Item => ({ t: "A", v });
export const U4 = (v: number): Item => ({ t: "U4", v });

function head(code: number, len: number): Buffer {
  const nb = len <= 0xff ? 1 : len <= 0xffff ? 2 : 3;
  const b = Buffer.alloc(1 + nb);
  b[0] = (code << 2) | nb;
  for (let i = 0; i < nb; i++) b[1 + i] = (len >> (8 * (nb - 1 - i))) & 0xff;
  return b;
}

export function encodeItem(it: Item): Buffer {
  switch (it.t) {
    case "L":
      return Buffer.concat([head(CODE.L, it.v.length), ...it.v.map(encodeItem)]);
    case "A": {
      const d = Buffer.from(it.v, "latin1");
      return Buffer.concat([head(CODE.A, d.length), d]);
    }
    case "B":
      return Buffer.concat([head(CODE.B, it.v.length), Buffer.from(it.v)]);
    case "BOOLEAN":
      return Buffer.concat([head(CODE.BOOLEAN, 1), Buffer.from([it.v ? 1 : 0])]);
    default: {
      const size = { U1: 1, U2: 2, U4: 4, I4: 4, F4: 4, F8: 8 }[it.t];
      const d = Buffer.alloc(size);
      if (it.t === "U1") d.writeUInt8(it.v);
      else if (it.t === "U2") d.writeUInt16BE(it.v);
      else if (it.t === "U4") d.writeUInt32BE(it.v);
      else if (it.t === "I4") d.writeInt32BE(it.v);
      else if (it.t === "F4") d.writeFloatBE(it.v);
      else d.writeDoubleBE(it.v);
      return Buffer.concat([head(CODE[it.t], size), d]);
    }
  }
}

export function decodeItem(buf: Buffer, at = 0): { item: Item; next: number } {
  const fmt = buf[at];
  const code = fmt >> 2;
  const nb = fmt & 3;
  let len = 0;
  for (let i = 0; i < nb; i++) len = (len << 8) | buf[at + 1 + i];
  const p = at + 1 + nb;
  const name = NAME.get(code);
  if (name === undefined) throw new Error(`unsupported SECS-II format 0o${code.toString(8)}`);
  if (name === "L") {
    const v: Item[] = [];
    let q = p;
    for (let i = 0; i < len; i++) {
      const r = decodeItem(buf, q);
      v.push(r.item);
      q = r.next;
    }
    return { item: { t: "L", v }, next: q };
  }
  const d = buf.subarray(p, p + len);
  const next = p + len;
  switch (name) {
    case "A":
      return { item: { t: "A", v: d.toString("latin1") }, next };
    case "B":
      return { item: { t: "B", v: [...d] }, next };
    case "BOOLEAN":
      return { item: { t: "BOOLEAN", v: d[0] !== 0 }, next };
    case "U1":
      return { item: { t: "U1", v: d.readUInt8() }, next };
    case "U2":
      return { item: { t: "U2", v: d.readUInt16BE() }, next };
    case "U4":
      return { item: { t: "U4", v: d.readUInt32BE() }, next };
    case "I4":
      return { item: { t: "I4", v: d.readInt32BE() }, next };
    case "F4":
      return { item: { t: "F4", v: d.readFloatBE() }, next };
    default:
      return { item: { t: "F8", v: d.readDoubleBE() }, next };
  }
}

export interface Reply {
  stream: number;
  func: number;
  body: Item | null;
}

export class HsmsHost {
  private sock!: net.Socket;
  private buf = Buffer.alloc(0);
  private sys = 1;
  private pending = new Map<number, (m: Reply | { control: number; status: number }) => void>();
  readonly log: string[] = [];

  constructor(
    readonly host: string,
    readonly port: number,
    readonly sessionId = 0,
    private readonly t3Ms = 8000,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(this.port, this.host);
      this.sock.once("error", reject);
      this.sock.once("connect", () => {
        this.sock.off("error", reject);
        this.sock.on("data", (d: Buffer) => this.onData(d));
        this.sock.on("error", () => undefined);
        resolve();
      });
    });
  }

  close() {
    this.sock?.destroy();
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (this.buf.length < 4 + len) return;
      const frame = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      const stype = frame[5];
      const sys = frame.readUInt32BE(6);
      if (stype === 0) {
        const stream = frame[2] & 0x7f;
        const func = frame[3];
        const wbit = (frame[2] & 0x80) !== 0;
        const body = frame.length > 10 ? decodeItem(Buffer.from(frame.buffer, frame.byteOffset + 10, frame.length - 10)).item : null;
        const cb = this.pending.get(sys);
        if (cb && !wbit) {
          this.pending.delete(sys);
          cb({ stream, func, body });
        } else if (wbit) {
          this.autoReply(stream, func, sys);
        }
      } else {
        const cb = this.pending.get(sys);
        if (cb) {
          this.pending.delete(sys);
          cb({ control: stype, status: frame[3] });
        } else if (stype === 5) this.sendControl(6, sys);
      }
    }
  }

  /** Primary messages the equipment sends to us (event reports, alarms): acknowledge and move on. */
  private autoReply(stream: number, func: number, sys: number) {
    const ack = encodeItem({ t: "B", v: [0] });
    this.write(this.header(stream, func + 1, false, 0, sys), ack);
  }

  private header(stream: number, func: number, w: boolean, stype: number, sys: number): Buffer {
    const h = Buffer.alloc(10);
    // Control messages (Select, Linktest) carry 0xFFFF as their session id, as secsgem sends them; data messages carry the device id.
    h.writeUInt16BE(stype === 0 ? this.sessionId : 0xffff, 0);
    h[2] = (w ? 0x80 : 0) | stream;
    h[3] = func;
    h[4] = 0;
    h[5] = stype;
    h.writeUInt32BE(sys, 6);
    return h;
  }

  private write(h: Buffer, body: Buffer = Buffer.alloc(0)) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(h.length + body.length);
    this.sock.write(Buffer.concat([len, h, body]));
  }

  private sendControl(stype: number, sys: number) {
    this.write(this.header(0, 0, false, stype, sys));
  }

  private wait<T>(sys: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sys);
        reject(new Error(`HSMS T3 timeout on ${this.host}:${this.port}`));
      }, this.t3Ms);
      this.pending.set(sys, (m) => {
        clearTimeout(timer);
        resolve(m as T);
      });
    });
  }

  async select(): Promise<void> {
    const sys = this.sys++;
    this.write(this.header(0, 0, false, 1, sys));
    const r = await this.wait<{ control: number; status: number }>(sys);
    if (r.control !== 2 || r.status !== 0) throw new Error(`Select refused, status ${r.status}`);
  }

  async linktest(): Promise<void> {
    const sys = this.sys++;
    this.sendControl(5, sys);
    await this.wait(sys);
  }

  async request(stream: number, func: number, body?: Item): Promise<Reply> {
    const sys = this.sys++;
    this.write(this.header(stream, func, true, 0, sys), body ? encodeItem(body) : Buffer.alloc(0));
    const r = await this.wait<Reply>(sys);
    this.log.push(`S${stream}F${func} -> S${r.stream}F${r.func}`);
    return r;
  }

  /** S1F13 then S1F17: establish communication, then ask the equipment to go online. */
  async goOnline(): Promise<void> {
    await this.request(1, 13, L());
    const r = await this.request(1, 17);
    const ack = r.body && r.body.t === "B" ? r.body.v[0] : -1;
    if (ack !== 0 && ack !== 2) throw new Error(`S1F17 refused, ONLACK ${ack}`);
  }

  /** S2F41 host command. Returns HCACK, 0 meaning accepted. */
  async command(name: string, params: Record<string, Item> = {}): Promise<number> {
    const list = Object.entries(params).map(([k, v]) => L(A(k), v));
    const r = await this.request(2, 41, L(A(name), L(...list)));
    const b = r.body;
    if (b && b.t === "L" && b.v[0] && b.v[0].t === "U1") return b.v[0].v;
    if (b && b.t === "L" && b.v[0] && b.v[0].t === "B") return b.v[0].v[0];
    return -1;
  }

  /** S1F3 selected equipment status request for one SVID. */
  async readSv(svid: number): Promise<number | string | null> {
    const r = await this.request(1, 3, L(U4(svid)));
    const b = r.body;
    if (b && b.t === "L" && b.v[0] && b.v[0].t !== "L" && b.v[0].t !== "B" && b.v[0].t !== "BOOLEAN") return b.v[0].v;
    return null;
  }
}
