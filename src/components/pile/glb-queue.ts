import { KTX2Loader, type GLTFLoader } from "three-stdlib";
import type { WebGLRenderer } from "three";

const MAX_ACTIVE = 4;
const BASIS = "https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/";

let active = 0;
const waiting: (() => void)[] = [];
const limited = new WeakSet<GLTFLoader>();
const ktx2 = new KTX2Loader();
ktx2.setTranscoderPath(BASIS);
let ktxReady = false;

export function bindKtx2(gl: WebGLRenderer) {
  if (ktxReady) return;
  ktx2.detectSupport(gl);
  ktxReady = true;
}

function pump() {
  while (active < MAX_ACTIVE) {
    const start = waiting.shift();
    if (!start) return;
    active += 1;
    start();
  }
}

function finish() {
  active -= 1;
  pump();
}

// Makes the loader fetch at most MAX_ACTIVE files at a time. The loader is shared,
// so this runs once for each loader.
export function limitLoads(loader: GLTFLoader) {
  loader.setKTX2Loader(ktx2);
  if (limited.has(loader)) return;
  limited.add(loader);
  const load = loader.load.bind(loader);
  loader.load = (url, onLoad, onProgress, onError) => {
    waiting.push(() =>
      load(
        url,
        (gltf) => {
          finish();
          onLoad(gltf);
        },
        onProgress,
        (error) => {
          finish();
          onError?.(error);
        },
      ),
    );
    pump();
  };
}
