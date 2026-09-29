const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const VERSION = "2026.09.30";
const screens = {
  intro: $("#introScreen"),
  experiment: $("#experimentScreen"),
  results: $("#resultsScreen"),
};

const stimulusCanvas = $("#stimulusCanvas");
const stimulusContext = stimulusCanvas.getContext("2d", { alpha: false });
const heroCanvas = $("#heroCanvas");
const heroContext = heroCanvas.getContext("2d");
const conditionCanvas = $("#conditionCanvas");
const conditionContext = conditionCanvas.getContext("2d");
const explainingCanvas = $("#explainingCanvas");
const explainingContext = explainingCanvas.getContext("2d");
const reconCanvas = $("#reconCanvas");
const reconContext = reconCanvas.getContext("2d");

const state = {
  trials: [],
  index: 0,
  responses: [],
  accepting: false,
  responseTimer: null,
  responseStarted: 0,
  slide: 0,
  heroReveal: false,
  activeCondition: "same",
  swapped: false,
  reconPlaying: true,
  reconStep: 1,
};

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function holdFor(duration) {
  const started = performance.now();
  let elapsed = 0;
  while (elapsed < duration) {
    await nextFrame();
    elapsed = performance.now() - started;
  }
  return elapsed;
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function switchScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove("is-active"));
  $("#deck").hidden = name !== "deck";
  if (screens[name]) screens[name].classList.add("is-active");
  $("#phaseLabel").textContent = name === "deck" ? "Paper presentation" : name === "results" ? "Your result" : "Interactive study";
  window.scrollTo(0, 0);
}

// Original procedural “sculptures”: recognizable by structure, but never repeated as targets.
// They avoid external image licensing and keep every trial deterministic.
function makeSculpture(seed, family = seed % 6) {
  const random = mulberry32(seed * 7919 + 17);
  const lobes = 7 + Math.floor(random() * 5);
  const radii = Array.from({ length: lobes }, () => 0.7 + random() * 0.42);
  return {
    id: `${seed}-${family}`,
    seed,
    family,
    lobes,
    radii,
    squeeze: 0.72 + random() * 0.42,
    appendages: 2 + Math.floor(random() * 4),
    appendageOffset: random() * Math.PI * 2,
    ring: random() > 0.42,
    ringAngle: random() * Math.PI,
    notch: random() > 0.5,
    spine: random() > 0.38,
    ridgeCount: 2 + Math.floor(random() * 4),
  };
}

const objectCache = new Map();

function traceBody(ctx, object, radius) {
  const points = object.radii.map((value, index) => {
    const angle = (index / object.lobes) * Math.PI * 2 - Math.PI / 2;
    return {
      x: Math.cos(angle) * radius * value,
      y: Math.sin(angle) * radius * value * object.squeeze,
    };
  });
  ctx.beginPath();
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const middleX = (point.x + next.x) / 2;
    const middleY = (point.y + next.y) / 2;
    if (index === 0) ctx.moveTo(middleX, middleY);
    ctx.quadraticCurveTo(next.x, next.y, (next.x + points[(index + 2) % points.length].x) / 2, (next.y + points[(index + 2) % points.length].y) / 2);
  });
  ctx.closePath();
}

function renderSculpture(object, tone = "rear", mask = false) {
  const key = `${object.id}-${tone}-${mask}`;
  if (objectCache.has(key)) return objectCache.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = 420;
  canvas.height = 420;
  const ctx = canvas.getContext("2d");
  ctx.translate(210, 210);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const fill = mask ? "#fff" : tone === "front" ? "#20231f" : tone === "ghost" ? "#c4c6c0" : "#92978f";
  const light = mask ? "#fff" : tone === "front" ? "#585d54" : "#c9ccc5";
  const stroke = mask ? "#fff" : tone === "front" ? "#090a09" : "#3f433d";

  // Appendages are structural, not decorative: they keep choices discriminable under rotation.
  for (let index = 0; index < object.appendages; index += 1) {
    const angle = object.appendageOffset + (index / object.appendages) * Math.PI * 2;
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = mask ? 12 : 7;
    ctx.beginPath();
    ctx.roundRect(72, -19, 105 + (index % 2) * 24, 38, 18);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(176 + (index % 2) * 22, 0, 30, 37, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (mask) {
    ctx.fillStyle = fill;
  } else {
    const gradient = ctx.createRadialGradient(-50, -75, 10, 20, 30, 185);
    gradient.addColorStop(0, light);
    gradient.addColorStop(1, fill);
    ctx.fillStyle = gradient;
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = mask ? 14 : 8;
  traceBody(ctx, object, 142);
  ctx.fill();
  ctx.stroke();

  if (!mask) {
    ctx.globalAlpha = tone === "front" ? 0.28 : 0.42;
    ctx.strokeStyle = tone === "front" ? "#d2d5ce" : "#f2f3ef";
    ctx.lineWidth = 4;
    for (let index = 1; index <= object.ridgeCount; index += 1) {
      ctx.beginPath();
      ctx.ellipse(-18, 5, 26 * index, 19 * index * object.squeeze, object.ringAngle, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (object.ring) {
    ctx.save();
    ctx.rotate(object.ringAngle);
    ctx.strokeStyle = mask ? "#fff" : tone === "front" ? "#747a70" : "#2f332e";
    ctx.lineWidth = mask ? 22 : 10;
    ctx.beginPath();
    ctx.ellipse(0, 0, 188, 66, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (object.spine) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = mask ? 18 : 9;
    ctx.beginPath();
    ctx.moveTo(-120, 110);
    ctx.bezierCurveTo(-40, 55, 35, 155, 130, 80);
    ctx.stroke();
  }

  if (object.notch && !mask) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(42, -22, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(42, -22, 25, 0, Math.PI * 2);
    ctx.stroke();
  }
  objectCache.set(key, canvas);
  return canvas;
}

function drawSculpture(ctx, object, transform, tone = "rear", alpha = 1, mask = false) {
  const image = renderSculpture(object, tone, mask);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(transform.x, transform.y);
  ctx.rotate(transform.rotation);
  ctx.scale(transform.scale, transform.scale);
  ctx.drawImage(image, -210, -210);
  ctx.restore();
}

function clearCanvas(ctx, color = "#faf8f2") {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

function drawField(ctx, seed, subtle = false) {
  const random = mulberry32(seed * 97 + 11);
  ctx.save();
  ctx.strokeStyle = subtle ? "rgba(23,25,21,.045)" : "rgba(23,25,21,.075)";
  ctx.lineWidth = 1;
  for (let index = 0; index < 42; index += 1) {
    const x = random() * ctx.canvas.width;
    const y = random() * ctx.canvas.height;
    const length = 10 + random() * 55;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - .5) * length, y + (random() - .5) * length);
    ctx.stroke();
  }
  ctx.restore();
}

function transformedMask(object, transform) {
  const canvas = document.createElement("canvas");
  canvas.width = stimulusCanvas.width;
  canvas.height = stimulusCanvas.height;
  drawSculpture(canvas.getContext("2d"), object, transform, "rear", 1, true);
  return canvas;
}

function overlapRatio(target, targetTransform, front, frontTransform) {
  const a = transformedMask(target, targetTransform).getContext("2d").getImageData(0, 0, stimulusCanvas.width, stimulusCanvas.height).data;
  const b = transformedMask(front, frontTransform).getContext("2d").getImageData(0, 0, stimulusCanvas.width, stimulusCanvas.height).data;
  let targetPixels = 0;
  let coveredPixels = 0;
  for (let index = 3; index < a.length; index += 16) {
    if (a[index] > 20) {
      targetPixels += 1;
      if (b[index] > 20) coveredPixels += 1;
    }
  }
  return targetPixels ? coveredPixels / targetPixels : 0;
}

function chooseOccluderPlacement(trial) {
  if (trial.frontTransform) return trial.frontTransform;
  const random = mulberry32(trial.seed + 331);
  const desired = .72 + random() * .16;
  let best = null;
  let bestDistance = Infinity;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = {
      x: trial.targetTransform.x + (random() - .5) * 70,
      y: trial.targetTransform.y + (random() - .5) * 55,
      rotation: (random() - .5) * 1.5,
      scale: 1.01 + random() * .42,
    };
    const ratio = overlapRatio(trial.target, trial.targetTransform, trial.occluder, candidate);
    const distance = Math.abs(ratio - desired);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { ...candidate, ratio };
    }
    if (ratio >= .7 && ratio <= .9 && distance < .025) break;
  }
  trial.frontTransform = best;
  trial.occlusion = best.ratio;
  return best;
}

function makeTrial(index, condition, practice = false) {
  const seed = 12000 + index * 887 + (practice ? 91 : 0);
  const random = mulberry32(seed);
  const family = index % 6;
  return {
    seed,
    condition,
    practice,
    target: makeSculpture(100 + index * 3, family),
    distractor: makeSculpture(101 + index * 3, family),
    occluder: makeSculpture(500 + index * 5, (family + 2) % 6),
    randomPrime: makeSculpture(900 + index * 7, (family + 4) % 6),
    targetTransform: {
      x: 475 + (random() - .5) * 80,
      y: 312 + (random() - .5) * 55,
      rotation: (random() - .5) * .85,
      scale: .92 + random() * .12,
    },
    optionOrder: random() > .5 ? ["target", "distractor"] : ["distractor", "target"],
    gap: random() > .5 ? 25 : 50,
  };
}

function buildTrials() {
  const random = mulberry32(Date.now() & 0xffffffff);
  const practice = [makeTrial(0, "same", true), makeTrial(1, "random", true)];
  const conditions = shuffle([...Array(10).fill("same"), ...Array(10).fill("random")], random);
  const measured = conditions.map((condition, index) => makeTrial(index + 2, condition, false));
  return [...practice, ...measured];
}

function drawPrime(trial) {
  clearCanvas(stimulusContext);
  drawField(stimulusContext, trial.seed, true);
  const object = trial.condition === "same" ? trial.occluder : trial.randomPrime;
  const transform = trial.condition === "same"
    ? { ...chooseOccluderPlacement(trial), x: 480, y: 300, scale: .82 }
    : { x: 480, y: 300, rotation: -.2, scale: .82 };
  drawSculpture(stimulusContext, object, transform, "front");
}

function drawScene(trial, ctx = stimulusContext, options = {}) {
  const { targetAlpha = 1, frontAlpha = 1, labels = false } = options;
  clearCanvas(ctx);
  drawField(ctx, trial.seed);
  const scaleX = ctx.canvas.width / stimulusCanvas.width;
  const scaleY = ctx.canvas.height / stimulusCanvas.height;
  ctx.save();
  ctx.scale(scaleX, scaleY);
  drawSculpture(ctx, trial.target, trial.targetTransform, "rear", targetAlpha);
  drawSculpture(ctx, trial.occluder, chooseOccluderPlacement(trial), "front", frontAlpha);
  if (labels) {
    ctx.font = "600 18px Inter, sans-serif";
    ctx.fillStyle = "#174f43";
    ctx.fillText("BACKGROUND HYPOTHESIS", 28, 44);
    ctx.fillStyle = "#e6522c";
    ctx.fillText("FOREGROUND CAUSE", 655, 555);
  }
  ctx.restore();
}

function drawChoice(canvas, object) {
  const ctx = canvas.getContext("2d");
  clearCanvas(ctx, "#fff");
  drawField(ctx, object.seed, true);
  drawSculpture(ctx, object, { x: canvas.width / 2, y: canvas.height / 2 + 4, rotation: 0, scale: .48 }, "rear");
}

function prepareTrial(trial) {
  chooseOccluderPlacement(trial);
  renderSculpture(trial.target, "rear");
  renderSculpture(trial.distractor, "rear");
  renderSculpture(trial.occluder, "front");
  renderSculpture(trial.randomPrime, "front");
}

async function runTrial() {
  state.accepting = false;
  window.clearTimeout(state.responseTimer);
  const trial = state.trials[state.index];
  prepareTrial(trial);
  $("#responsePanel").hidden = true;
  $("#stageMessage").hidden = true;
  clearCanvas(stimulusContext);
  $("#fixation").style.display = "block";
  await holdFor(500);
  $("#fixation").style.display = "none";

  drawPrime(trial);
  trial.primeActualMs = await holdFor(500);
  clearCanvas(stimulusContext);
  await holdFor(trial.gap);

  drawScene(trial);
  trial.sceneActualMs = await holdFor(400);
  clearCanvas(stimulusContext);
  await holdFor(100);
  showResponse(trial);
}

function showResponse(trial) {
  const grid = $("#choiceGrid");
  grid.innerHTML = "";
  trial.optionOrder.forEach((kind, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.dataset.answer = kind;
    button.setAttribute("aria-label", `${index === 0 ? "Left" : "Right"} object`);
    const marker = document.createElement("span");
    marker.textContent = index === 0 ? "←" : "→";
    const choiceCanvas = document.createElement("canvas");
    choiceCanvas.width = 360;
    choiceCanvas.height = 220;
    button.append(marker, choiceCanvas);
    button.addEventListener("click", () => submitResponse(kind));
    grid.append(button);
    drawChoice(choiceCanvas, trial[kind]);
  });
  $("#responsePanel").hidden = false;
  state.accepting = true;
  state.responseStarted = performance.now();
  state.responseTimer = window.setTimeout(() => submitResponse(null), 3000);
}

async function submitResponse(answer) {
  if (!state.accepting) return;
  state.accepting = false;
  window.clearTimeout(state.responseTimer);
  const trial = state.trials[state.index];
  const responseTime = performance.now() - state.responseStarted;
  const correct = answer === "target";
  state.responses.push({
    condition: trial.condition,
    practice: trial.practice,
    correct,
    missed: answer === null,
    responseTime,
    occlusion: trial.occlusion,
    primeActualMs: trial.primeActualMs,
    sceneActualMs: trial.sceneActualMs,
  });
  $("#responsePanel").hidden = true;
  state.index += 1;

  if (state.index === 2) {
    $("#experimentPhase").textContent = "Measured experiment";
    await showStageMessage("Practice complete · No feedback from here on.", 1200);
  }
  if (state.index === 12) await showStageMessage("Halfway · keep choosing the object behind.", 950);
  if (state.index >= state.trials.length) {
    await showStageMessage("Comparing the two clues…", 800);
    showResults();
    return;
  }
  updateTrialCounter();
  runTrial();
}

async function showStageMessage(message, duration) {
  clearCanvas(stimulusContext);
  $("#stageMessageText").textContent = message;
  $("#stageMessage").hidden = false;
  await wait(duration);
  $("#stageMessage").hidden = true;
}

function updateTrialCounter() {
  const measuredIndex = Math.max(0, state.index - 2);
  if (state.index < 2) {
    $("#trialCurrent").textContent = state.index + 1;
    $("#trialTotal").textContent = "2 practice";
    $("#trialProgress").style.width = `${(state.index / 2) * 100}%`;
  } else {
    $("#trialCurrent").textContent = Math.min(20, measuredIndex + 1);
    $("#trialTotal").textContent = "20";
    $("#trialProgress").style.width = `${(measuredIndex / 20) * 100}%`;
  }
}

function summarizeCondition(condition) {
  const rows = state.responses.filter((row) => !row.practice && row.condition === condition);
  const correct = rows.filter((row) => row.correct).length;
  const responded = rows.filter((row) => !row.missed);
  return {
    count: rows.length,
    correct,
    accuracy: rows.length ? Math.round((correct / rows.length) * 100) : 0,
    medianRt: median(responded.map((row) => row.responseTime)),
  };
}

function showResults() {
  const same = summarizeCondition("same");
  const random = summarizeCondition("random");
  const benefit = same.accuracy - random.accuracy;
  const rtBenefit = same.medianRt && random.medianRt ? random.medianRt - same.medianRt : null;
  $("#sameAccuracy").textContent = `${same.accuracy}%`;
  $("#randomAccuracy").textContent = `${random.accuracy}%`;
  $("#accuracyBenefit").textContent = `${benefit > 0 ? "+" : ""}${benefit}`;
  $("#sameRt").textContent = same.medianRt ? `${(same.medianRt / 1000).toFixed(2)} s median RT` : "no timed response";
  $("#randomRt").textContent = random.medianRt ? `${(random.medianRt / 1000).toFixed(2)} s median RT` : "no timed response";
  $("#sameBarLabel").textContent = `${same.accuracy}%`;
  $("#randomBarLabel").textContent = `${random.accuracy}%`;

  const direction = benefit > 0 ? "matched" : benefit < 0 ? "reversed" : "did not separate";
  $("#resultNarrative").textContent = benefit > 0
    ? `The matching occluder cue improved your accuracy by ${benefit} percentage points in this short run.`
    : benefit < 0
      ? `Your short run went ${Math.abs(benefit)} points in the opposite direction. With ten trials per condition, that can happen easily.`
      : "Your two conditions tied in this short run.";
  const rtText = rtBenefit === null ? "" : rtBenefit > 0
    ? ` Your median response was also ${Math.round(rtBenefit)} ms faster after the matching occluder.`
    : ` Your median response was ${Math.abs(Math.round(rtBenefit))} ms slower after the matching occluder.`;
  $("#resultExplanation").textContent = `You got ${same.correct}/${same.count} same-occluder trials and ${random.correct}/${random.count} random-object trials correct. The direction ${direction} the paper’s group effect.${rtText} This is a personal demonstration with novel procedural objects—not an inferential result. The paper used up to 400 trials, strict exclusions, and group statistics.`;
  $("#personalSlideText").textContent = `In your 20 measured trials: ${same.accuracy}% correct after the same occluder versus ${random.accuracy}% after a random object (${benefit > 0 ? "+" : ""}${benefit} points). Now separate that experience from the paper’s evidence.`;
  switchScreen("results");
  requestAnimationFrame(() => {
    $("#sameBar").style.width = `${same.accuracy}%`;
    $("#randomBar").style.width = `${random.accuracy}%`;
  });
}

function startExperiment() {
  state.trials = buildTrials();
  state.index = 0;
  state.responses = [];
  state.accepting = false;
  window.clearTimeout(state.responseTimer);
  $("#instructionCard").hidden = false;
  $("#responsePanel").hidden = true;
  $("#stageMessage").hidden = true;
  $("#experimentPhase").textContent = "Instructions";
  $("#trialCurrent").textContent = "0";
  $("#trialTotal").textContent = "20";
  $("#trialProgress").style.width = "0";
  clearCanvas(stimulusContext);
  switchScreen("experiment");
}

function beginTrials() {
  $("#instructionCard").hidden = true;
  $("#experimentPhase").textContent = "Practice";
  updateTrialCounter();
  runTrial();
}

// Demonstration canvases use the same renderer as the experiment.
const demoTrial = makeTrial(44, "same", false);
prepareTrial(demoTrial);

function drawHero(time = 0) {
  clearCanvas(heroContext);
  drawField(heroContext, 44);
  const pulse = (Math.sin(time / 1300) + 1) / 2;
  const sx = heroCanvas.width / stimulusCanvas.width;
  const sy = heroCanvas.height / stimulusCanvas.height;
  heroContext.save();
  heroContext.scale(sx, sy);
  drawSculpture(heroContext, demoTrial.target, demoTrial.targetTransform, "rear");
  drawSculpture(heroContext, demoTrial.occluder, demoTrial.frontTransform, "front", state.heroReveal ? .08 : .9 + pulse * .1);
  heroContext.restore();
  requestAnimationFrame(drawHero);
}

function drawCondition(condition = state.activeCondition) {
  const ctx = conditionContext;
  clearCanvas(ctx);
  const split = ctx.canvas.width * .34;
  ctx.strokeStyle = "rgba(23,25,21,.2)";
  ctx.beginPath();
  ctx.moveTo(split, 20);
  ctx.lineTo(split, ctx.canvas.height - 20);
  ctx.stroke();
  const prime = condition === "same" ? demoTrial.occluder : demoTrial.randomPrime;
  drawSculpture(ctx, prime, { x: split / 2, y: 230, rotation: condition === "same" ? demoTrial.frontTransform.rotation : -.2, scale: .43 }, "front");
  ctx.fillStyle = "#6e7068";
  ctx.font = "11px Inter, sans-serif";
  ctx.fillText("PRIME · 500 MS", 20, 28);
  ctx.fillText("OCCLUDED SCENE · 400 MS", split + 20, 28);
  ctx.save();
  ctx.beginPath();
  ctx.rect(split + 1, 0, ctx.canvas.width - split, ctx.canvas.height);
  ctx.clip();
  ctx.translate(split - 100, 20);
  ctx.scale(.62, .72);
  drawSculpture(ctx, demoTrial.target, demoTrial.targetTransform, "rear");
  drawSculpture(ctx, demoTrial.occluder, demoTrial.frontTransform, "front");
  ctx.restore();
}

function drawExplaining(time = 0) {
  clearCanvas(explainingContext);
  drawField(explainingContext, 78, true);
  const phase = (time / 1400) % 3;
  const targetAlpha = phase < 1 ? .52 : phase < 2 ? .75 : 1;
  const frontAlpha = phase < 1 ? 1 : phase < 2 ? .58 : .16;
  const sx = explainingCanvas.width / stimulusCanvas.width;
  const sy = explainingCanvas.height / stimulusCanvas.height;
  explainingContext.save();
  explainingContext.scale(sx, sy);
  drawSculpture(explainingContext, demoTrial.target, demoTrial.targetTransform, "rear", targetAlpha);
  drawSculpture(explainingContext, demoTrial.occluder, demoTrial.frontTransform, "front", frontAlpha);
  explainingContext.restore();
  explainingContext.fillStyle = "#171915";
  explainingContext.font = "600 11px Inter, sans-serif";
  explainingContext.fillText(phase < 1 ? "1 · MIXED EVIDENCE" : phase < 2 ? "2 · OCCLUDER EXPLAINED" : "3 · BACKGROUND UPDATED", 18, 26);
  requestAnimationFrame(drawExplaining);
}

function drawRecon() {
  const ctx = reconContext;
  clearCanvas(ctx);
  drawField(ctx, 181, true);
  const progress = state.reconStep / 5;
  const transform = { x: 280, y: 222, rotation: demoTrial.targetTransform.rotation * (1 - progress), scale: .64 };
  ctx.save();
  ctx.globalAlpha = .24 + progress * .76;
  if (state.reconStep < 3) ctx.filter = `blur(${(3 - state.reconStep) * 2.2}px)`;
  drawSculpture(ctx, demoTrial.target, transform, "rear");
  ctx.restore();
  if (state.reconStep < 5) {
    ctx.strokeStyle = `rgba(230,82,44,${.65 - progress * .35})`;
    ctx.setLineDash([8, 9]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(280, 220, 145 + state.reconStep * 5, 112 + state.reconStep * 4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  $("#reconStep").textContent = `t = ${state.reconStep}`;
  $("#reconProgress").style.width = `${state.reconStep * 20}%`;
}

window.setInterval(() => {
  if (!state.reconPlaying || $("#deck").hidden || state.slide !== 7) return;
  state.reconStep = state.reconStep % 5 + 1;
  drawRecon();
}, 850);

function populateModelGrid() {
  const families = [
    ...Array.from({ length: 9 }, (_, index) => ["ff", `FF ${index + 1}`]),
    ...Array.from({ length: 8 }, (_, index) => ["rec", `Rec ${index + 1}`]),
    ...Array.from({ length: 6 }, (_, index) => ["td", `TD ${index + 1}`]),
  ];
  $("#modelGrid").innerHTML = families.map(([family, label], index) => `<div class="model-chip ${family}" style="--i:${index}"><span>${label}</span></div>`).join("");
}

const popovers = {
  paperResult: ["The published human effect", "Mean accuracy was .765 after the same foreground object and .725 after a random object (paired t-test, p < 10⁻⁴). Mean reaction time was also faster: .935 s versus .974 s (p < 10⁻¹¹)."],
  demoCaveat: ["Experience, not replication", "This site uses 20 measured trials and original procedural stimuli. The published task allowed up to 400 trials, included attention checks, and analyzed 41 participants who passed quality criteria. Your score is descriptive only."],
  datasetDetail: ["Controlled geometry", "The model dataset used T-shirt/top, pullover, bag, and ankle boot. Their comparable pixel areas made it easier to control occlusion uniformly between 50% and 75% across 16 foreground–background class pairs."],
  causalScope: ["Causal inside the model", "Changing prediction order and perturbing hidden states are interventions on trained networks, so they support a causal computational claim there. They are not direct causal interventions on human brains."],
  qcDetail: ["Quality criteria", "Participants were excluded for mean response time below 100 ms, missing more than 20% of attention checks, or mean accuracy below .55. Forty-one of 182 starters remained. The paper reports no a priori sample-size calculation."],
  reconLimit: ["A feasibility model", "Recon-Net shows that iterative analysis-by-synthesis can recover a useful unoccluded representation. It works in pixel space and is inspired by V4–vlPFC dynamics; it does not establish that the brain implements this exact architecture."],
};

function openPopover(key) {
  const [title, text] = popovers[key];
  $("#popoverContent").innerHTML = `<h3>${title}</h3><p>${text}</p>`;
  $("#popover").hidden = false;
}

function showSlide(index) {
  const slides = $$(".slide");
  state.slide = Math.max(0, Math.min(slides.length - 1, index));
  slides.forEach((slide, slideIndex) => slide.classList.toggle("is-current", slideIndex === state.slide));
  const current = slides[state.slide];
  $("#currentSlideNumber").textContent = state.slide + 1;
  $("#currentSlideLabel").textContent = current.dataset.label;
  $("#deckProgress").style.width = `${((state.slide + 1) / slides.length) * 100}%`;
  $("#previousSlide").disabled = state.slide === 0;
  $("#nextSlide").disabled = state.slide === slides.length - 1;
  if (state.slide === 7) drawRecon();
}

function enterDeck() {
  if (!state.responses.some((row) => !row.practice)) {
    $("#personalSlideText").textContent = "This deck normally opens with the visitor’s own two-condition result. You skipped the demonstration, so we will move directly from the task logic to the group evidence.";
  }
  switchScreen("deck");
  history.replaceState(null, "", `${location.pathname}#presentation`);
  showSlide(0);
}

function handleKeydown(event) {
  if (state.accepting && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const trial = state.trials[state.index];
    const optionIndex = event.key === "ArrowLeft" ? 0 : 1;
    submitResponse(trial.optionOrder[optionIndex]);
    return;
  }
  if (!$("#deck").hidden) {
    if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); showSlide(state.slide + 1); }
    if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); showSlide(state.slide - 1); }
    if (event.key === "Home") showSlide(0);
    if (event.key === "End") showSlide(9);
  }
  if (event.key === "Escape") $("#popover").hidden = true;
}

$("#startButton").addEventListener("click", startExperiment);
$("#readyButton").addEventListener("click", beginTrials);
$("#retryButton").addEventListener("click", startExperiment);
$("#enterDeckButton").addEventListener("click", enterDeck);
$("#introPresentationButton").addEventListener("click", enterDeck);
$("#presentationLink").addEventListener("click", (event) => { event.preventDefault(); enterDeck(); });
$("#exitExperiment").addEventListener("click", () => { state.accepting = false; window.clearTimeout(state.responseTimer); switchScreen("intro"); });
$("#previousSlide").addEventListener("click", () => showSlide(state.slide - 1));
$("#nextSlide").addEventListener("click", () => showSlide(state.slide + 1));
$("#fullscreenButton").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
$("#aboutButton").addEventListener("click", () => $("#aboutDialog").showModal());
$("#closeAbout").addEventListener("click", () => $("#aboutDialog").close());
$("#aboutDialog").addEventListener("click", (event) => { if (event.target === $("#aboutDialog")) $("#aboutDialog").close(); });
$("#closePopover").addEventListener("click", () => $("#popover").hidden = true);
$$("[data-popover]").forEach((button) => button.addEventListener("click", () => openPopover(button.dataset.popover)));
$("#heroReveal").addEventListener("pointerdown", () => { state.heroReveal = true; });
$("#heroReveal").addEventListener("pointerup", () => { state.heroReveal = false; });
$("#heroReveal").addEventListener("pointerleave", () => { state.heroReveal = false; });
$$("#conditionSwitch button").forEach((button) => button.addEventListener("click", () => {
  state.activeCondition = button.dataset.condition;
  $$("#conditionSwitch button").forEach((item) => item.classList.toggle("active", item === button));
  $("#conditionCaption").textContent = state.activeCondition === "same"
    ? "The prime matches the foreground object, so it can be discounted."
    : "The prime is unrelated, so it provides no useful explanation for the foreground.";
  drawCondition();
}));
$("#swapState").addEventListener("click", () => {
  state.swapped = !state.swapped;
  $(".state-swap").classList.toggle("is-swapped", state.swapped);
  $("#stateCaption").textContent = state.swapped ? "Background recognition impaired" : "Background recognition intact";
});
$("#reconPlay").addEventListener("click", () => {
  state.reconPlaying = !state.reconPlaying;
  $("#reconPlay").textContent = state.reconPlaying ? "pause" : "play";
});
$(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  history.replaceState(null, "", location.pathname);
  switchScreen("intro");
});
document.addEventListener("keydown", handleKeydown);

clearCanvas(stimulusContext);
populateModelGrid();
drawCondition();
drawRecon();
requestAnimationFrame(drawHero);
requestAnimationFrame(drawExplaining);
if (location.hash === "#presentation") enterDeck();

console.info(`Explaining Away Occlusion ${VERSION} · all responses remain local`);
