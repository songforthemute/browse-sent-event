import {
  closePanel,
  getSnapshotCounts,
  runEventSource,
  runFetchStream,
  runWebSocket,
  seedPanel,
} from "./fixture-probe.js";

const fixtureBridge = {
  closePanel,
  getSnapshotCounts,
  runEventSource,
  runFetchStream,
  runWebSocket,
  seedPanel,
};

Reflect.set(globalThis, "__bseFixture", fixtureBridge);

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Fixture root is missing");
}

app.innerHTML = `
  <main>
    <h1>browse-sent-event browser fixture</h1>
    <button id="seed" type="button">Seed panel</button>
  </main>
`;

document.querySelector<HTMLButtonElement>("#seed")?.addEventListener("click", () => {
  fixtureBridge.seedPanel();
});
