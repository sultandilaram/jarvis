import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";
const [port] = (
  await readFile(
    process.env.HOME + "/Library/Application Support/JARVIS/DevToolsActivePort",
    "utf8",
  )
)
  .trim()
  .split("\n");
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().endsWith("/dist/index.html"));
const configuration=await page.evaluate(()=>window.jarvis.snapshot());
if(!configuration.hasApiKey||configuration.settings.voiceProvider!=="live"||configuration.settings.voiceName!=="vesper")throw Error("Expected ready key and Vesper live configuration.");
const result = await page.evaluate(async () => {
  const pc = new RTCPeerConnection();
  const audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.value = 0;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  pc.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
  const channel = pc.createDataChannel("oai-events");
  const types = [];
  const errors = [];
  let selectedVoice=null,transcript="";
  let started = false,
    closed = false,
    usage = null;
  channel.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    types.push(event.type);
    if(event.type==="session.output_transcript.delta")transcript+=event.delta||"";
    if (event.type === "session.started") {
      started = true;
      selectedVoice=event.session?.audio?.output?.voice||null;
      channel.send(
        JSON.stringify({
          type: "session.commentary.append",
          event_id: crypto.randomUUID(),
          delegation_id: null,
          content:
            "Say in your usual composed voice: At your service, sir. The command interface is ready. Do not delegate or take any action.",
        }),
      );
    }
    if (event.type === "session.closed") {
      closed = true;
      usage = event.usage;
    }
    if (event.type === "error") errors.push(event.error?.message);
  };
  try {
    await audio.resume();
    await pc.setLocalDescription(await pc.createOffer());
    for (let i = 0; i < 100 && pc.iceGatheringState !== "complete"; i++)
      await new Promise((r) => setTimeout(r, 50));
    const answer = await window.jarvis.voiceConnect(pc.localDescription.sdp);
    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    for (let i = 0; i < 100 && !started && !errors.length; i++)
      await new Promise((r) => setTimeout(r, 100));
    if (started) await new Promise((r) => setTimeout(r, 4000));
    let incomingBytes = 0,
      outgoingPackets = 0;
    for (const s of (await pc.getStats()).values()) {
      if (s.type === "inbound-rtp" && s.kind === "audio")
        incomingBytes += s.bytesReceived || 0;
      if (s.type === "outbound-rtp" && s.kind === "audio")
        outgoingPackets += s.packetsSent || 0;
    }
    if (channel.readyState === "open") {
      channel.send(
        JSON.stringify({
          type: "session.close",
          event_id: crypto.randomUUID(),
        }),
      );
      for (let i = 0; i < 30 && !closed; i++)
        await new Promise((r) => setTimeout(r, 100));
    }
    return {
      started,
      closed,
      selectedVoice,
      transcript,
      usage,
      incomingBytes,
      outgoingPackets,
      types: [...new Set(types)],
      errors,
      connectionState: pc.connectionState,
    };
  } catch (e) {
    return { started, closed, error: e.message, types: [...new Set(types)] };
  } finally {
    channel.close();
    pc.close();
    oscillator.stop();
    destination.stream.getTracks().forEach((t) => t.stop());
    await audio.close();
  }
});
await writeFile(
  ".jarvis/verification/hud/voice-probe.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({requestedVoice:configuration.settings.voiceName,...result}));
if(!result.started||!result.closed||!result.incomingBytes||result.errors?.length)process.exitCode=1;
await browser.close();
