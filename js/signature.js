// Minimal touch/mouse signature pad (no dependencies).
window.SignaturePad = function (canvas, onChange) {
  const ctx = canvas.getContext("2d");
  let drawing = false;
  let last = null;
  let hasInk = false;
  let savedUrl = null;

  function resize() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    // Canvas is on a hidden screen — size it when the screen is shown instead.
    if (!rect.width || !rect.height) return;
    // Skip if nothing changed (mobile browsers fire resize when the URL bar hides).
    if (canvas.width === Math.round(rect.width * ratio) && canvas.height === Math.round(rect.height * ratio)) return;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f4a";
    if (savedUrl) drawImage(savedUrl);
  }

  function wipe() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function drawImage(url) {
    const img = new Image();
    img.onload = () => {
      if (url !== savedUrl) return; // cleared or replaced meanwhile
      wipe();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    img.src = url;
  }

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    last = pos(e);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = "#0b1f4a";
    ctx.fill();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    hasInk = true;
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    hasInk = true;
    savedUrl = canvas.toDataURL("image/png");
    onChange && onChange(savedUrl);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", end);

  window.addEventListener("resize", resize);
  resize();

  return {
    clear(silent) {
      wipe();
      hasInk = false;
      savedUrl = null;
      if (!silent && onChange) onChange(null);
    },
    load(url) {
      if (!url) return;
      savedUrl = url;
      hasInk = true;
      drawImage(url);
    },
    isEmpty() { return !hasInk; },
    resize,
    toDataURL() { return savedUrl; },
  };
};
