# simready-pile

**[stuff.grok.me](https://stuff.grok.me)**

A full-screen physics pile for the phone. [NVIDIA SimReady](https://huggingface.co/datasets/nvidia/simready-assets) props and [Amazon Berkeley Objects](https://huggingface.co/datasets/codepawl/abo-glb) drop into one ring. Each visit is a new random set. An object never falls twice.

Tilt the phone and gravity follows. Drag anything to move it. **More Stuff** releases the next batch. The bulb on the left is the light. The **i** on the right opens this repo.

![The pile along the bottom of a phone](docs/pile-phone.png)

## Assets

| Source | License | In this repo |
| --- | --- | --- |
| [nvidia/simready-assets](https://huggingface.co/datasets/nvidia/simready-assets) | CC BY 4.0, NVIDIA | `glb/` and `catalog.json`, scaled and simplified |
| [codepawl/abo-glb](https://huggingface.co/datasets/codepawl/abo-glb) | CC BY 4.0, Amazon Berkeley Objects | `public/abo-catalog.json`. Meshes load from Hugging Face |

## Run

```
npm install
npm run dev
```
