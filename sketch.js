// Live sketch: a Gray-Scott reaction-diffusion pattern that grows out of a typed word or a photo,
// and moves with the microphone. Plain WebGL2, no dependencies. Nothing is uploaded anywhere.
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $("c"), note = $("note");
  const gl = canvas.getContext("webgl2", { antialias: false });
  // The simulation renders into float textures; without that there is nothing to show.
  if (!gl || !(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"))) {
    note.textContent = "This sketch needs WebGL2, which this browser doesn't have turned on.";
    return;
  }

  const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

  const HEAD = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D state, mask;
uniform vec2 px;
float lum(vec2 at) { return dot(texture(mask, at).rgb, vec3(.299, .587, .114)); }`;

  // Start: the shape (bright parts of the word or photo) is seeded, plus a few specks so the whole frame fills in.
  const SEED = HEAD + `
uniform float salt;
float hash(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233)) + salt) * 43758.5453); }
void main() {
  float h = hash(floor(uv / px)), blob = hash(floor(uv / px / 5.) + 7.); // single-pixel specks die out, so seed 5px blobs
  float b = max(step(.5, lum(uv)) * step(.5, h), step(.992, blob));
  o = vec4(1., b, 0., 1.);
}`;

  // One Gray-Scott step. The source image bends the feed and kill rates, so it stays readable as the pattern grows.
  const STEP = HEAD + `
uniform vec4 brush;   // x, y, radius, strength
uniform float aspect, bass;
void main() {
  vec2 s = texture(state, uv).rg;
  vec2 e = vec2(px.x, 0.), n = vec2(0., px.y);
  vec2 lap = -s
    + .2 * (texture(state, uv + e).rg + texture(state, uv - e).rg + texture(state, uv + n).rg + texture(state, uv - n).rg)
    + .05 * (texture(state, uv + e + n).rg + texture(state, uv + e - n).rg + texture(state, uv - e + n).rg + texture(state, uv - e - n).rg);
  float m = lum(uv);
  float feed = mix(.0545, .030, m);
  float kill = mix(.062, .056, m) - .0015 * bass;
  float r = s.r * s.g * s.g;
  float a = s.r + lap.r - r + feed * (1. - s.r);
  float b = s.g + .5 * lap.g + r - (kill + feed) * s.g;
  float d = length((uv - brush.xy) * vec2(aspect, 1.));
  b = max(b, brush.w * smoothstep(brush.z, brush.z * .5, d));
  o = vec4(clamp(a, 0., 1.), clamp(b, 0., 1.), 0., 1.);
}`;

  const SHOW = HEAD + `
uniform float glow;
void main() {
  float b = texture(state, uv).g;
  float dx = texture(state, uv + vec2(px.x, 0.)).g - texture(state, uv - vec2(px.x, 0.)).g;
  float dy = texture(state, uv + vec2(0., px.y)).g - texture(state, uv - vec2(0., px.y)).g;
  float light = clamp(dot(normalize(vec3(-dx * 8., -dy * 8., 1.)), normalize(vec3(-.5, .6, .6))), 0., 1.);
  float body = smoothstep(.1, .3, b);
  vec3 deep = vec3(.02, .05, .07), coral = vec3(.98, .45, .36), bone = vec3(1., .93, .85);
  vec3 flesh = mix(coral, bone, max(light * light, .75 * lum(uv))); // the word or photo reads lighter than what grows around it
  vec3 c = mix(deep, flesh * (.5 + .6 * light + .4 * glow), body);
  o = vec4(c, 1.);
}`;

  const program = (fs) => {
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.bindAttribLocation(prog, 0, "p");
    gl.linkProgram(prog);
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(prog, i).name;
      u[name] = gl.getUniformLocation(prog, name);
    }
    return { prog, u };
  };
  const seed = program(SEED), step = program(STEP), show = program(SHOW);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = (wrap) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  };
  const states = [0, 1].map(() => ({ tex: texture(gl.REPEAT), fbo: gl.createFramebuffer() }));
  const maskTex = texture(gl.CLAMP_TO_EDGE);
  const maskCanvas = document.createElement("canvas");
  const ctx = maskCanvas.getContext("2d");

  const SIM = 720; // long side of the simulation grid; the pattern's scale doesn't depend on screen size
  let w = 0, h = 0, src = 0, source = { text: "live sketch" }, brush = [0, 0, 0, 0];

  const use = ({ prog, u }, target, tw, th) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, tw, th);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, states[src].tex); gl.uniform1i(u.state, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(u.mask, 1);
    gl.uniform2f(u.px, 1 / w, 1 / h);
    return u;
  };

  // Draw the word or photo into the mask, then restart the pattern from it.
  const grow = () => {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    if (source.image) {
      const { width: iw, height: ih } = source.image, k = Math.max(w / iw, h / ih); // cover the frame
      ctx.drawImage(source.image, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
    } else {
      ctx.font = "800 100px system-ui, sans-serif";
      const size = Math.min((100 * w * .86) / ctx.measureText(source.text).width, h * .6);
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(source.text, w / 2, h / 2);
    }
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
    gl.uniform1f(use(seed, states[src].fbo, w, h).salt, Math.random() * 100);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    const k = SIM / Math.max(innerWidth, innerHeight);
    w = maskCanvas.width = Math.max(64, Math.round(innerWidth * k));
    h = maskCanvas.height = Math.max(64, Math.round(innerHeight * k));
    for (const s of states) {
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.tex, 0);
    }
    grow();
  };
  let resizeTimer;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); });

  // Word
  $("f").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = $("t").value.trim();
    if (text) { source.image?.close(); source = { text }; grow(); }
  });

  // Photo: decoded and drawn in this tab only.
  $("photo").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try { const image = await createImageBitmap(file); source.image?.close(); source = { image }; grow(); }
    catch { note.textContent = "That file didn't open as a photo. Try a JPG or PNG."; }
    ev.target.value = "";
  });

  // Drag to stir
  const stir = (ev) => { if (ev.buttons || ev.type === "pointerdown") brush = [ev.clientX / innerWidth, 1 - ev.clientY / innerHeight, .02, .9]; };
  canvas.addEventListener("pointerdown", stir);
  canvas.addEventListener("pointermove", stir);

  // Microphone: bass loosens the pattern, level brightens it, a beat drops a ripple.
  let analyser = null, stopMic = null, bins = null, bass = 0, average = 0, lastBeat = 0;
  $("mic").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    if (analyser) { stopMic(); analyser = null; bass = 0; btn.setAttribute("aria-pressed", "false"); btn.textContent = "Listen"; return; }
    btn.disabled = true; // a second click while the permission prompt is open would start a second stream
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audio = new AudioContext();
      analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      bins = new Uint8Array(analyser.frequencyBinCount);
      audio.createMediaStreamSource(stream).connect(analyser);
      stopMic = () => { stream.getTracks().forEach((t) => t.stop()); audio.close(); };
      btn.setAttribute("aria-pressed", "true"); btn.textContent = "Listening";
    } catch { btn.textContent = "Mic blocked"; }
    btn.disabled = false;
  });
  const listen = (now) => {
    if (!analyser) return;
    analyser.getByteFrequencyData(bins);
    bass = (bins[1] + bins[2] + bins[3] + bins[4] + bins[5]) / (5 * 255);
    average += (bass - average) * .05;
    if (bass > .3 && bass > average * 1.35 && now - lastBeat > 250) {
      lastBeat = now;
      brush = [Math.random(), Math.random(), .03, .9];
    }
  };

  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const params = new URLSearchParams(location.search), selftest = params.has("selftest");
  const steps = +params.get("steps") || (calm ? 3 : 12); // ?steps=N fast-forwards (used by the self-test)
  const draw = (now) => {
    listen(now);
    for (let i = 0; i < steps; i++) {
      const u = use(step, states[1 - src].fbo, w, h);
      gl.uniform4fv(u.brush, brush); gl.uniform1f(u.aspect, w / h); gl.uniform1f(u.bass, bass);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = 1 - src; brush = [0, 0, 0, 0];
    }
    gl.uniform1f(use(show, null, canvas.width, canvas.height).glow, bass);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // ?selftest: marks the page once the frame holds a pattern and not one flat colour.
    if (selftest && document.body.dataset.grown !== "yes") {
      const n = 64, px = new Uint8Array(n * n * 4);
      gl.readPixels((canvas.width - n) >> 1, (canvas.height - n) >> 1, n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lo = 255, hi = 0;
      for (let i = 0; i < px.length; i += 4) { lo = Math.min(lo, px[i]); hi = Math.max(hi, px[i]); }
      document.body.dataset.grown = hi - lo > 60 ? "yes" : "no";
    }
    requestAnimationFrame(draw);
  };

  canvas.addEventListener("webglcontextlost", () => { note.textContent = "The graphics were reset by the browser. Reload to start again."; });
  resize();
  requestAnimationFrame(draw);
})();
