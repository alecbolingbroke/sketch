# Live sketch

A pattern that grows like coral out of a word you type or a photo you pick, and moves with the music in the room.

- **Type a word** and press Enter: the letters seed the pattern.
- **Photo**: the bright parts of the picture seed it, and the picture keeps shaping how it grows. The photo is read in your browser and never uploaded.
- **Drag** on the canvas to stir in new growth.
- **Listen**: with the microphone on, bass loosens the pattern, loudness brightens it, and each beat drops a ripple.

## How it works

It is a Gray-Scott reaction-diffusion simulation running in WebGL2 fragment shaders: two chemicals on a grid, one feeding on the other. The word or photo is drawn to a small canvas and used twice: to seed the second chemical, and to bend the feed and kill rates so the source stays readable as everything grows around it.

No build step and no dependencies: `index.html` and `sketch.js`.

## Run it

Open `index.html` in a browser. The microphone needs `https` or `localhost`, so for that serve the folder:

```
python3 -m http.server 8000
```

## Check it

`?selftest` marks `<body data-grown="yes">` once the canvas holds a pattern instead of one flat colour, and `?steps=N` fast-forwards. With Chrome installed:

```
chrome --headless=new --enable-unsafe-swiftshader --virtual-time-budget=7000 --dump-dom "http://localhost:8000/?selftest&steps=60" | grep data-grown
```
