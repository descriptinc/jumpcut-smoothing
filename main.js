// Video Regenerate — project page interactions
(function () {
  "use strict";

  /* ===============================================================
   * MEDIA CONFIG — single source of truth.
   *
   * For each clip you need to provide two things:
   *   1. transcript — a tracked-changes string of what was said. Mark
   *      edits inline:
   *        [+new words+]  -> regenerated / inserted words (highlighted)
   *        [-old words-]  -> original words that were changed/removed
   *      A replacement is [-old-][+new+]. On "Reveal edit" the new words
   *      highlight, and the original (ground-truth) line appears with the
   *      changed words struck through. Leave "" to hide the transcript.
   *   2. edits — the regenerated frame spans, as a list of
   *      [startSec, endSec] pairs (in SECONDS). A clip can have
   *      MULTIPLE regions, e.g. edits: [[1.2, 2.4], [5.0, 6.1]].
   *      These mark the regenerated frames on the timeline and light
   *      up a frame-level indicator during playback. (Values below are
   *      PLACEHOLDER guesses — replace with the real spans.)
   * =============================================================== */
  // Standalone Jumpcut Smoothing site: only the jumpcut comparison is used here.
  // (Editing/translation panels live on the Video Regenerate site.)
  var MEDIA = {
    hero: { src: "", transcript: "", edits: [] },
    samples: [],
    translation: [],

    jumpcut: {
      // raw = hard cut (no jumpcut smoothing), smooth = regenerated bridge.
      // transcript + edits are filled from media/transcripts.overrides.json.
      examples: [
        { id: "henry", title: "Henry", raw: "media/henry_regen_1_no_jcs.mp4", smooth: "media/henry_regen_1.mp4", edits: [[4.1, 6.9]], transcript: "" },
        { id: "jacky", title: "Jacky", raw: "media/jacky_chen_regen_1_no_jcs.mp4", smooth: "media/jacky_chen_regen_1.mp4", edits: [[7.6, 9.4]], transcript: "" },
        { id: "diary", title: "Diary", raw: "media/diary_regen_1_no_jcs.mp4", smooth: "media/diary_regen_1.mp4", edits: [[2.2, 4.1]], transcript: "" }
      ]
    }
  };

  // Tiles whose transcript/edits can be filled from media/transcripts.json.
  var REGISTRY = [];
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Videos are served from the GCS bucket.
  var MEDIA_BASE = "https://storage.googleapis.com/lyrebird-research-web-demos/jumpcut-smoothing/";
  function mediaUrl(p) { return MEDIA_BASE + String(p).replace(/^media\//, ""); }

  /* --------------------------------------------------------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Store the regenerated frame spans (a list of [startSec, endSec]) on
  // the tile. These are temporal — specific frames, not a pixel region.
  function setEdits(tile, edits) {
    tile._edits = (edits && edits.length) ? edits.slice() : [];
  }

  // Render the regenerated spans as bands on the scrubber timeline.
  // Needs the clip duration to map seconds -> %.
  function renderRegions(tile, duration) {
    var track = tile.querySelector(".scrubber__track");
    if (!track || !duration) return;
    var cont = track.querySelector(".scrubber__regions");
    if (!cont) {
      cont = document.createElement("div");
      cont.className = "scrubber__regions";
      track.insertBefore(cont, track.firstChild);
    }
    cont.innerHTML = "";
    var isJc = tile.classList.contains("video-tile--jc");
    (tile._edits || []).forEach(function (pair) {
      var left = Math.max(0, Math.min(100, pair[0] / duration * 100));
      var width = Math.max(1.2, Math.min(100 - left, (pair[1] - pair[0]) / duration * 100));
      var d = document.createElement("div");
      // Jumpcut clips show the same band on both sides so the regions line up.
      d.className = "scrubber__region" + (isJc ? " scrubber__region--bridge" : "");
      d.style.left = left + "%";
      d.style.width = width + "%";
      cont.appendChild(d);
    });
  }

  // Make a tile's scrubber clickable to seek. `seek(t)` receives seconds.
  function bindSeek(tile, seek) {
    var track = tile.querySelector(".scrubber__track");
    if (!track) return;
    track.addEventListener("click", function (e) {
      e.stopPropagation();
      var dur = tile._duration || (tile.querySelector("video") || {}).duration;
      if (!dur) return;
      var rect = track.getBoundingClientRect();
      var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(frac * dur);
    });
  }

  // Is the playhead currently inside any regenerated span?
  function isInEdit(tile, t) {
    return (tile._edits || []).some(function (p) { return t >= p[0] && t <= p[1]; });
  }

  /* ---------------------------------------------------------------
   * Load (or swap) a tile's video source. Probes first so a missing
   * file gracefully falls back to the animated placeholder.
   * ------------------------------------------------------------- */
  function loadTileSource(tile, src) {
    if (!src) return;
    src = mediaUrl(src);
    var video = tile.querySelector(".video-tile__video");
    var source = video.querySelector("source");
    var probe = document.createElement("video");
    probe.muted = true;
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", function () {
      var wasPlaying = video.getAttribute("src") || (source.getAttribute("src") && !video.paused);
      source.setAttribute("src", src);
      video.load();
      tile.classList.add("has-video");
      tile._duration = probe.duration;
      // Map the regenerated frame spans onto the timeline now that we know duration.
      renderRegions(tile, probe.duration);
      if (wasPlaying) { video.play().catch(function () {}); }
    });
    probe.addEventListener("error", function () { /* keep placeholder */ });
    probe.src = src;
  }

  /* ---------------------------------------------------------------
   * Per-tile wiring: play/pause + scrubber.
   * ------------------------------------------------------------- */
  function setupTile(tile) {
    var video = tile.querySelector(".video-tile__video");
    var source = video ? video.querySelector("source") : null;
    var playBtn = tile.querySelector(".video-tile__play");
    var progress = tile.querySelector(".scrubber__progress");

    if (video) {
      video.addEventListener("timeupdate", function () {
        if (progress && video.duration) {
          // Playhead position (a thin marker, so the region bands stay visible).
          progress.style.left = (video.currentTime / video.duration) * 100 + "%";
        }
        // Frame-level indicator: light up only while inside a regenerated span.
        tile.classList.toggle("in-edit", isInEdit(tile, video.currentTime));
      });
      // Only one clip plays at a time so audio never overlaps.
      video.addEventListener("play", function () {
        tile.classList.add("is-playing");
        document.querySelectorAll(".video-tile__video").forEach(function (v) {
          if (v !== video && !v.paused) { v.pause(); }
        });
      });
      video.addEventListener("pause", function () { tile.classList.remove("is-playing"); });
      // Stop at the end (no loop); show the replay button again.
      video.addEventListener("ended", function () { tile.classList.remove("is-playing"); });

      addMuteToggle(tile, video);
      addFullscreenToggle(tile, video);
      bindSeek(tile, function (t) { video.currentTime = t; });
    }

    var initial = source && source.getAttribute("data-srcref");
    if (initial) { loadTileSource(tile, initial); }

    if (playBtn) {
      playBtn.addEventListener("click", function () {
        if (tile.classList.contains("has-video")) {
          if (video.paused) { video.play(); } else { video.pause(); }
        } else {
          tile.classList.toggle("is-playing");
          fakeScrub(tile, progress);
        }
      });
    }
  }

  var ICON_VOL_ON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>';
  var ICON_VOL_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm18.29-.71L19.88 6.88 17 9.76l-2.88-2.88-1.41 1.41L15.59 11l-2.88 2.88 1.41 1.41L17 12.41l2.88 2.88 1.41-1.41L18.41 11l2.88-2.71z"/></svg>';
  var ICON_FS =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';

  // Add a fullscreen toggle. Uses the standard API with iOS/Safari fallbacks.
  function addFullscreenToggle(tile, video) {
    if (!video) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "video-tile__fs";
    btn.setAttribute("aria-label", "Fullscreen");
    btn.innerHTML = ICON_FS;
    tile.appendChild(btn);
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var doc = document;
      var isFs = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (isFs) {
        (doc.exitFullscreen || doc.webkitExitFullscreen || function () {}).call(doc);
        return;
      }
      var target = tile;
      if (target.requestFullscreen) { target.requestFullscreen(); }
      else if (target.webkitRequestFullscreen) { target.webkitRequestFullscreen(); }
      else if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); } // iOS Safari
    });
  }

  // Add a mute/unmute toggle. Clips play with sound (only one at a time);
  // this lets the viewer silence them.
  function addMuteToggle(tile, video) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "video-tile__mute";
    btn.setAttribute("aria-label", "Mute");
    btn.innerHTML = ICON_VOL_ON;
    tile.appendChild(btn);
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      video.muted = !video.muted;
      btn.innerHTML = video.muted ? ICON_VOL_OFF : ICON_VOL_ON;
      btn.classList.toggle("is-muted", video.muted);
      btn.setAttribute("aria-label", video.muted ? "Unmute" : "Mute");
    });
  }

  function fakeScrub(tile, progress) {
    if (!progress) return;
    if (tile._raf) { cancelAnimationFrame(tile._raf); tile._raf = null; progress.style.left = "0%"; tile.classList.remove("is-playing"); return; }
    var startT = performance.now();
    var dur = 6000;
    function step(now) {
      var t = ((now - startT) % dur) / dur;
      progress.style.left = (t * 100) + "%";
      tile._raf = requestAnimationFrame(step);
    }
    tile._raf = requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------------
   * Transcript (tracked changes). Markers:
   *   [+inserted+]  -> regenerated / new words
   *   [-deleted-]   -> original words that were changed/removed
   * Renders an "edited" line (new words highlighted on reveal) and an
   * "original" ground-truth line (changed words struck through).
   * ------------------------------------------------------------- */
  // Render a single unified diff line: unchanged text stays plain, removed
  // words show struck-through (only once revealed), inserted words are
  // highlighted. Before reveal the line reads as the final edited sentence.
  function buildUnifiedRow(diff) {
    var html = "";
    var prev = null; // "ins" | "del" | "plain"
    diff.split(/(\[\+[\s\S]*?\+\]|\[-[\s\S]*?-\])/g).forEach(function (tok) {
      if (!tok) return;
      var ins = tok.match(/^\[\+([\s\S]*?)\+\]$/);
      var del = tok.match(/^\[-([\s\S]*?)-\]$/);
      // Keep a space between adjacent del/ins so the diff reads cleanly.
      if ((ins || del) && (prev === "ins" || prev === "del")) {
        html += '<span class="seg seg--gap"> </span>';
      }
      if (ins) { html += '<span class="seg ins">' + escapeHtml(ins[1]) + "</span>"; prev = "ins"; }
      else if (del) { html += '<span class="seg del">' + escapeHtml(del[1]) + "</span>"; prev = "del"; }
      else { html += '<span class="seg">' + escapeHtml(tok) + "</span>"; prev = "plain"; }
    });
    return html;
  }

  function renderTranscript(el, diff, opts) {
    if (!el) return;
    opts = opts || {};
    if (!diff) { el.hidden = true; el.innerHTML = ""; el.classList.remove("transcript--on"); return; }
    el.hidden = false;
    el.classList.toggle("transcript--on", !!opts.alwaysOn);
    var label = opts.editedLabel || "Edited";
    el.innerHTML =
      '<div class="transcript__row transcript__row--diff">' +
        '<span class="transcript__label">' + label + "</span>" +
        '<span class="transcript__text">' + buildUnifiedRow(diff) + "</span>" +
      "</div>";
  }

  /* ---------------------------------------------------------------
   * Reveal-edit buttons (toggle .is-revealed on the reveal root).
   * ------------------------------------------------------------- */
  function setupReveal(btn) {
    btn.addEventListener("click", function () {
      var root;
      var targetId = btn.getAttribute("data-target");
      if (targetId) { root = document.getElementById(targetId); }
      else { root = btn.closest("[data-reveal-root]") || btn.closest(".sample, .jc-stage, figure"); }
      if (!root) return;
      var revealed = root.classList.toggle("is-revealed");
      btn.classList.toggle("is-active", revealed);
      btn.textContent = revealed ? "Hide edit" : "Reveal edit";
    });
  }

  /* ---------------------------------------------------------------
   * Hero demo.
   * ------------------------------------------------------------- */
  function setupHero() {
    var fig = document.getElementById("hero-demo");
    if (!fig) return;
    var tile = fig.querySelector(".video-tile");
    setEdits(tile, MEDIA.hero.edits);
    tile.querySelector("source").setAttribute("data-srcref", MEDIA.hero.src || "");
    var transcriptEl = fig.querySelector("[data-transcript]");
    renderTranscript(transcriptEl, MEDIA.hero.transcript, { editedLabel: "Edited" });
    REGISTRY.push({ src: MEDIA.hero.src, tile: tile, transcriptEl: transcriptEl, opts: { editedLabel: "Edited" } });
  }

  /* ---------------------------------------------------------------
   * Fill transcripts + edit spans from media/transcripts.json
   * (produced by scripts/transcribe_and_diff.py), if present.
   * ------------------------------------------------------------- */
  // Merged transcript/edit data (auto + overrides), keyed by filename.
  var TXDATA = {};
  // Callbacks to re-render once TXDATA is available (e.g. the jumpcut section).
  var TX_REFRESH = [];

  function applyTranscripts() {
    var getJson = function (url) {
      return fetch(url, { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; });
    };
    // Auto transcripts + hand-tuned overrides (overrides win, per field).
    Promise.all([
      getJson("media/transcripts.json"),
      getJson("media/transcripts.overrides.json")
    ]).then(function (res) {
      var data = res[0] || {}, over = res[1] || {};
      var keys = {};
      Object.keys(data).forEach(function (k) { keys[k] = 1; });
      Object.keys(over).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        if (k.charAt(0) === "_") return;
        var base = data[k] || {}, ovr = over[k] || {};
        TXDATA[k] = {
          transcript: ovr.transcript != null ? ovr.transcript : base.transcript,
          edits: ovr.edits != null ? ovr.edits : base.edits
        };
      });
      REGISTRY.forEach(function (item) {
        var t = TXDATA[item.src.split("/").pop()];
        if (!t) return;
        if (t.edits && t.edits.length) {
          setEdits(item.tile, t.edits);
          if (item.tile._duration) { renderRegions(item.tile, item.tile._duration); }
        }
        if (t.transcript != null) { renderTranscript(item.transcriptEl, t.transcript, item.opts); }
      });
      TX_REFRESH.forEach(function (fn) { fn(); });
    });
  }

  /* ---------------------------------------------------------------
   * Generic tabbed examples: tabs switch which panel is shown.
   * ------------------------------------------------------------- */
  function makeTab(i, label, active) {
    var b = document.createElement("button");
    b.className = "tab" + (active ? " is-active" : "");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("data-i", String(i));
    b.textContent = label;
    return b;
  }

  function setupTabs(tabsEl, stageEl) {
    if (!tabsEl || !stageEl) return;
    var tabs = [].slice.call(tabsEl.querySelectorAll(".tab"));
    var panels = [].slice.call(stageEl.querySelectorAll(".tab-panel"));
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var i = tab.getAttribute("data-i");
        tabs.forEach(function (t) { t.classList.toggle("is-active", t === tab); });
        panels.forEach(function (p) {
          var on = p.getAttribute("data-i") === i;
          p.classList.toggle("is-active", on);
          if (!on) { // pause any video in a hidden panel
            p.querySelectorAll("video").forEach(function (v) { if (!v.paused) v.pause(); });
          }
        });
      });
    });
  }

  /* ---------------------------------------------------------------
   * Video Regenerate — curated editing examples (tabbed).
   * ------------------------------------------------------------- */
  function buildRegen() {
    var tabsEl = document.getElementById("regen-tabs");
    var stageEl = document.getElementById("regen-stage");
    if (!tabsEl || !stageEl) return;
    MEDIA.samples.forEach(function (s, i) {
      tabsEl.appendChild(makeTab(i, String(i + 1), i === 0));
      var panel = document.createElement("div");
      panel.className = "tab-panel sample" + (i === 0 ? " is-active" : "");
      panel.setAttribute("data-reveal-root", "");
      panel.setAttribute("data-i", String(i));
      panel.innerHTML =
        '<div class="sample__media">' +
          '<div class="video-tile">' +
            '<video class="video-tile__video" playsinline preload="metadata">' +
              '<source data-srcref="' + s.src + '" type="video/mp4" />' +
            '</video>' +
            '<div class="video-tile__placeholder" aria-hidden="true">' +
              '<div class="ph-face"><span class="ph-face__head"></span><span class="ph-face__mouth"></span></div>' +
              '<p>Talking-head clip</p>' +
            '</div>' +
            '<button class="video-tile__play" type="button" aria-label="Play clip">' +
              '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>' +
            '</button>' +
            '<div class="scrubber"><div class="scrubber__track">' +
              '<div class="scrubber__regions"></div>' +
              '<div class="scrubber__progress"></div>' +
            '</div></div>' +
            '<span class="region-badge">regenerated frames</span>' +
          '</div>' +
        '</div>' +
        '<div class="sample__bar">' +
          '<button class="reveal-btn" type="button">Reveal edit</button>' +
        '</div>' +
        '<div class="transcript" data-transcript hidden></div>';
      stageEl.appendChild(panel);
      var tile = panel.querySelector(".video-tile");
      var transcriptEl = panel.querySelector("[data-transcript]");
      setEdits(tile, s.edits);
      renderTranscript(transcriptEl, s.transcript);
      REGISTRY.push({ src: s.src, tile: tile, transcriptEl: transcriptEl, opts: {} });
    });
    setupTabs(tabsEl, stageEl);
  }

  /* ---------------------------------------------------------------
   * Translation — original vs translated pairs (tabbed).
   * ------------------------------------------------------------- */
  function transTile(src, poster, cap, isGen) {
    return '' +
      '<div class="trans-item">' +
        '<span class="trans-cap' + (isGen ? " trans-cap--gen" : "") + '">' + escapeHtml(cap) + '</span>' +
        '<div class="video-tile">' +
          '<video class="video-tile__video" playsinline preload="metadata"' + (poster ? ' poster="' + poster + '"' : "") + '>' +
            '<source data-srcref="' + src + '" type="video/mp4" />' +
          '</video>' +
          '<div class="video-tile__placeholder" aria-hidden="true">' +
            '<div class="ph-face"><span class="ph-face__head"></span><span class="ph-face__mouth"></span></div>' +
            '<p>Talking-head clip</p>' +
          '</div>' +
          '<button class="video-tile__play" type="button" aria-label="Play clip">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>' +
          '</button>' +
          '<div class="scrubber"><div class="scrubber__track">' +
            '<div class="scrubber__regions"></div>' +
            '<div class="scrubber__progress"></div>' +
          '</div></div>' +
        '</div>' +
      '</div>';
  }

  function buildTranslation() {
    var tabsEl = document.getElementById("translation-tabs");
    var stageEl = document.getElementById("translation-stage");
    if (!tabsEl || !stageEl) return;
    (MEDIA.translation || []).forEach(function (ex, i) {
      tabsEl.appendChild(makeTab(i, ex.lang || String(i + 1), i === 0));
      var panel = document.createElement("div");
      panel.className = "tab-panel trans-ex" + (i === 0 ? " is-active" : "");
      panel.setAttribute("data-i", String(i));
      panel.innerHTML =
        '<div class="trans-pair">' +
          transTile(ex.original, ex.originalPoster, "Original", false) +
          transTile(ex.generated, ex.generatedPoster, "Translated · generated", true) +
        "</div>";
      stageEl.appendChild(panel);
    });
    setupTabs(tabsEl, stageEl);
  }

  /* ---------------------------------------------------------------
   * Method figures: animated latent grids + denoising matrix.
   * ------------------------------------------------------------- */
  function pipelineGrids() {
    var latent = document.getElementById("latentGrid");
    var gen = document.getElementById("genGrid");
    var K = 4;
    function makeFrame(masked) {
      var f = document.createElement("span"); f.className = "pframe";
      var low = document.createElement("span"); low.className = "pframe__low" + (masked ? " is-mask" : "");
      f.appendChild(low); return f;
    }
    if (latent) for (var i = 0; i < K; i++) latent.appendChild(makeFrame(false));
    if (gen) {
      var lows = [];
      for (var j = 0; j < K; j++) { var f = makeFrame(true); lows.push(f.querySelector(".pframe__low")); gen.appendChild(f); }
      if (!reduceMotion) {
        setInterval(function () {
          lows.forEach(function (m, idx) {
            setTimeout(function () { m.classList.add("is-filled"); setTimeout(function () { m.classList.remove("is-filled"); }, 900); }, idx * 180);
          });
        }, 2600);
      }
    }
  }

  function denoiseDemo() {
    var row = document.getElementById("denoiseRow");
    var btn = document.getElementById("denoiseRun");
    var stepEl = document.getElementById("denoiseStep");
    var maxEl = document.getElementById("denoiseMax");
    if (!row) return;
    var COLS = 22, ROWS = 7, MAX_STEPS = 10;
    var refCols = 3, maskFromRow = 4;
    if (maxEl) maxEl.textContent = MAX_STEPS;
    row.style.gridTemplateColumns = "repeat(" + COLS + ", 1fr)";
    var colBase = [];
    for (var c = 0; c < COLS; c++) colBase.push(0.3 + 0.6 * (0.5 + 0.5 * Math.sin(c * 0.8 + 0.6)));
    function gauss() {
      var u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      var n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.max(0, Math.min(1, 0.5 + n * 0.25));
    }
    var cells = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        var el = document.createElement("span");
        el.className = "denoise__cell";
        var masked = c2 >= refCols && r >= maskFromRow;
        if (masked) el.classList.add("is-mask");
        cells.push({ el: el, masked: masked, target: colBase[c2] });
        row.appendChild(el);
      }
    }
    function render(t) {
      for (var k = 0; k < cells.length; k++) {
        var cell = cells[k], val;
        if (cell.masked) { val = cell.target * t + gauss() * (1 - t); }
        else { val = cell.target; }
        cell.el.style.opacity = (0.06 + 0.94 * val).toFixed(3);
      }
      if (stepEl) stepEl.textContent = Math.round(t * MAX_STEPS);
    }
    render(0);
    var running = false;
    function run() {
      if (running) return;
      running = true;
      if (reduceMotion) { render(1); running = false; return; }
      var start = performance.now(), DURATION = 4000;
      function frame(now) {
        var t = Math.min(1, (now - start) / DURATION);
        render(t);
        if (t < 1) requestAnimationFrame(frame);
        else { render(1); running = false; }
      }
      requestAnimationFrame(frame);
    }
    if (btn) btn.addEventListener("click", run);
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { run(); io.disconnect(); } });
      }, { threshold: 0.4 });
      io.observe(row);
    }
  }

  /* ---------------------------------------------------------------
   * Jumpcut comparison: example picker + hard-cut/smoothing toggle.
   * ------------------------------------------------------------- */
  function setupJumpcut() {
    var root = document.getElementById("jc-compare");
    if (!root) return;
    var picker = root.querySelector(".jc-picker");
    var rawTile = root.querySelector('[data-jc="raw"]');
    var smoothTile = root.querySelector('[data-jc="smooth"]');
    if (!rawTile || !smoothTile) return;
    var rawVid = rawTile.querySelector("video");
    var smoothVid = smoothTile.querySelector("video");
    var transcriptEl = root.querySelector("[data-jc-transcript]");
    var examples = (MEDIA.jumpcut && MEDIA.jumpcut.examples) || [];
    var cur = 0;

    // Synced A/B with identical audio — only one side carries sound (the
    // "with smoothing" clip), so the two copies don't echo. It's the master
    // for sync + audio; the muted left clip is nudged to match it.
    rawVid.muted = true;
    smoothVid.muted = false;

    examples.forEach(function (ex, i) {
      var b = document.createElement("button");
      b.className = "jc-pick" + (i === 0 ? " is-active" : "");
      b.type = "button";
      b.textContent = "Example " + (i + 1);
      b.addEventListener("click", function () {
        cur = i;
        picker.querySelectorAll(".jc-pick").forEach(function (x) { x.classList.toggle("is-active", x === b); });
        load();
      });
      picker.appendChild(b);
    });
    if (examples.length <= 1 && picker) { picker.style.display = "none"; }

    function playBoth() {
      // Pause any other clip on the page so audio never overlaps.
      document.querySelectorAll(".video-tile__video").forEach(function (v) {
        if (v !== rawVid && v !== smoothVid && !v.paused) { v.pause(); }
      });
      try { rawVid.currentTime = 0; smoothVid.currentTime = 0; } catch (e) {}
      smoothVid.play().catch(function () {});
      rawVid.play().catch(function () {});
    }
    function pauseBoth() { rawVid.pause(); smoothVid.pause(); }
    function toggleBoth() { if (smoothVid.paused) { playBoth(); } else { pauseBoth(); } }

    // Smooth (audible) clip is the master; nudge the muted left clip to match
    // so re-syncing never glitches the audio track.
    smoothVid.addEventListener("timeupdate", function () {
      if (!smoothVid.paused && Math.abs(rawVid.currentTime - smoothVid.currentTime) > 0.15) {
        rawVid.currentTime = smoothVid.currentTime;
      }
    });

    // Mute toggle on the audible (smooth) clip; fullscreen on both.
    addMuteToggle(smoothTile, smoothVid);
    addFullscreenToggle(rawTile, rawVid);
    addFullscreenToggle(smoothTile, smoothVid);

    // Pull transcript/edits from overrides+auto data (keyed by smooth file),
    // falling back to the MEDIA.jumpcut config.
    function txFor(ex) {
      var t = TXDATA[ex.smooth.split("/").pop()] || {};
      return {
        transcript: t.transcript != null ? t.transcript : ex.transcript,
        edits: (t.edits && t.edits.length) ? t.edits : ex.edits
      };
    }

    function applyTxt() {
      var ex = examples[cur];
      if (!ex) return;
      var tx = txFor(ex);
      setEdits(rawTile, tx.edits);
      setEdits(smoothTile, tx.edits);
      if (rawTile._duration) { renderRegions(rawTile, rawTile._duration); }
      if (smoothTile._duration) { renderRegions(smoothTile, smoothTile._duration); }
      renderTranscript(transcriptEl, tx.transcript, { alwaysOn: true, showOriginal: false, editedLabel: "Transcript" });
    }

    function load() {
      var ex = examples[cur];
      if (!ex) return;
      pauseBoth();
      var tx = txFor(ex);
      setEdits(rawTile, tx.edits);
      setEdits(smoothTile, tx.edits);
      loadTileSource(rawTile, ex.raw);
      loadTileSource(smoothTile, ex.smooth);
      renderTranscript(transcriptEl, tx.transcript, { alwaysOn: true, showOriginal: false, editedLabel: "Transcript" });
    }
    TX_REFRESH.push(applyTxt);

    // Wire each tile's playhead / frame indicator; clicking either plays both.
    [rawTile, smoothTile].forEach(function (tile) {
      var v = tile.querySelector("video");
      var progress = tile.querySelector(".scrubber__progress");
      var playBtn = tile.querySelector(".video-tile__play");
      v.addEventListener("timeupdate", function () {
        if (progress && v.duration) { progress.style.left = (v.currentTime / v.duration) * 100 + "%"; }
        tile.classList.toggle("in-edit", isInEdit(tile, v.currentTime));
      });
      v.addEventListener("play", function () { tile.classList.add("is-playing"); });
      v.addEventListener("pause", function () { tile.classList.remove("is-playing"); });
      // When either clip finishes, stop both (no loop) and show the replay button.
      v.addEventListener("ended", function () { tile.classList.remove("is-playing"); pauseBoth(); });
      if (playBtn) { playBtn.addEventListener("click", toggleBoth); }
      // Clicking either bar seeks both clips in sync.
      bindSeek(tile, function (t) { smoothVid.currentTime = t; rawVid.currentTime = t; });
    });

    load();
  }

  /* ---------------------------------------------------------------
   * Copy citation.
   * ------------------------------------------------------------- */
  function setupCite() {
    var btn = document.getElementById("cite-copy");
    var pre = document.getElementById("cite-text");
    if (!btn || !pre) return;
    btn.addEventListener("click", function () {
      var text = pre.textContent;
      var done = function () {
        btn.classList.add("copied");
        btn.textContent = "Copied ✓";
        setTimeout(function () { btn.classList.remove("copied"); btn.textContent = "Copy"; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta); done();
      }
    });
  }

  /* ---------------------------------------------------------------
   * Init.
   * ------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", function () {
    setupHero();
    buildRegen();
    buildTranslation();
    // jumpcut tiles are managed by setupJumpcut (synced dual player).
    document.querySelectorAll(".video-tile:not(.video-tile--jc)").forEach(setupTile);
    document.querySelectorAll(".reveal-btn").forEach(setupReveal);
    pipelineGrids();
    denoiseDemo();
    setupJumpcut();
    setupCite();
    applyTranscripts();
  });
})();
