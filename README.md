# Live sketch

A pattern that grows like coral out of a word you type or a photo you pick, and moves with the music in the room.

- **Just type**: there is no text box. A caret blinks after the word while you type, and each keystroke redraws it and starts the growth over. On a phone, tap the picture to bring up the keyboard. Enter starts the growth over.
- **Photo**: the bright parts of the picture seed it, and the picture keeps shaping how it grows. The photo is read in your browser and never uploaded.
- **Drag** on the canvas to stir in new growth.
- **Color**: the swatch changes the color of the whole piece.
- **Listen**: with the microphone on, bass leans the flow outward, high notes glint, and each beat sends a swell out.

## How it works

It is a Gray-Scott reaction-diffusion simulation running in WebGL2 fragment shaders: two chemicals on a grid, one feeding on the other. The word or photo is drawn to a small canvas and used twice: to seed the second chemical, and to bend the feed and kill rates so the source shapes what grows.

- **A typed word** is drawn as solid, soft-edged letters from the first frame, and the coral grows out of it.
- **A photo** has no solid layer: the pattern itself redraws the picture.
- Growth fades out before the borders, so there is always a clean margin.
- It grows on its own and never quite settles, because the feed and kill rates wander slowly, and the light swings slowly across the surface.
- **Swells** happen only with the microphone on: each beat sends one soft bulge out from the centre.

With "reduce motion" turned on in the system settings it still grows, but the rules stop drifting and nothing swells.

No build step and no dependencies: `index.html` and `sketch.js`. The type is the reader's own system font.

## Run it

Open `index.html` in a browser. The microphone needs `https` or `localhost`, so for that serve the folder:

```
python3 -m http.server 8000
```

## Check it

`?selftest` marks `<body data-grown="yes">` once clearly more of the frame is lit than at the start, which means the pattern really grew. `?steps=N` fast-forwards, and `?time=N` starts the slow drift clock at N seconds, to check that it grows at any point in the drift. With Chrome installed:

```
chrome --headless=new --enable-unsafe-swiftshader --virtual-time-budget=7000 --dump-dom "http://localhost:8000/?selftest&steps=1200" | grep data-grown
```
