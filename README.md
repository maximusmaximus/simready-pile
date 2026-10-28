# simready-pile

**Play it:** [stuff.grok.me](https://stuff.grok.me)

A full-screen phone pile of NVIDIA SimReady props. The lights start on. One percent of the library drops into a ring, tilted so you can see things land flat. Tap **More Stuff** for the next percent. Tilt the phone and gravity follows. Drag an object to flick it.

On a phone the pile keeps at most 150 objects, draws no shadows or antialiasing, and loads four files at a time. A phone has a touch screen and a short side under 820 CSS pixels.

The bulb on the left of More Stuff turns the room lights on and off. The **i** on the right opens this repo.

![The pile on a phone, with the light, More Stuff, and info controls along the bottom](docs/pile-phone.png)

![The same pile a little wider, still framed along the bottom of the screen](docs/pile-wide.png)

## What's here

- The viewer in `src/` — React Three Fiber and Rapier, with device tilt for gravity
- `catalog.json` — id, mass, convex hull, and mesh url for each prop
- `glb/` — one simplified mesh per asset

Source assets are [nvidia/simready-assets](https://huggingface.co/datasets/nvidia/simready-assets), CC BY 4.0, NVIDIA. These GLBs are scaled, decimated derivatives. The originals stay on Hugging Face.

## Run

```
npm install
npm run dev
```
