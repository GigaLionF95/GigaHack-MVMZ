//=============================================================================
// GigaHack MV/MZ
// 03 · ui.js — design tokens, services and widget factory
//-----------------------------------------------------------------------------
// This is a PORT of ui-design/mm-overlay.js, not a redesign. The :root token
// block, the class names (mm- prefix), the #mm-root scoping and every widget's
// look and interaction come from the mockup verbatim.
//
// Deliberate changes from the mockup, all behavioural:
//   · buildStage() / buildDemo() dropped (fake MZ canvas + demo strip).
//   · The single fake store `S` is gone; widgets take values from callers.
//   · mmEditCell + every change handler now consult GigaHack.isReadOnly().
//   · mmTable gained an opt-in virtual mode (§2: tables >200 rows).
//   · #mm-root is click-through except over actual widgets, so the game canvas
//     still receives input where the overlay is transparent.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack — UI design system (ported from ui-design/)
 * @author gigahack
 * @help GigaHack_UI.js — requires GigaHack_Core.js, GigaHack_Caps.js, GigaHack_Store.js
 */

(function ($) {
    'use strict';
    if (!$) { console.error('[GigaHack] core missing — ui not installed'); return; }

    var U = $.ui;

    /* =====================================================================
       1. STYLE — token block lifted from the mockup unchanged

       THE CSS FLOOR IS CHROMIUM 66. MV 1.6 ships NW.js 0.29, which is Chromium
       66; older MV is worse. Nothing in this sheet may need more than that, and
       an unsupported value is not a soft failure — it invalidates the whole
       declaration (and, for a custom property, every rule that reads it), so
       the overlay collapses rather than degrading.

       Consequences visible below, each marked where it lands:
         · flex `gap` needs 84  → margins on the children instead
         · min()/max()/clamp()  needs 79  → fixed values, or a media query
         · color-mix()          needs 111 → derived in JS by applyAccent()
         · two-position colour stops in a gradient need 72 → written long-hand
       Safe on the floor and used freely: var() (49), position:sticky (56),
       :focus-within (60), overflow-anchor (56), overscroll-behavior (63),
       calc() (26), grid (57) and flexbox itself.

       $.caps.cssGap / $.caps.cssClamp probe the live renderer so the boot
       report can name what is missing; the sheet never depends on either.
       ===================================================================== */
    var CSS = String.raw`
#mm-root{
  /* --- accent (single configurable hue) --- */
  --mm-accent:#6c7ae0;
  /* Derived accents. The mockup expresses these with color-mix(), which needs
     Chromium 111+ — far above the floor, and an unsupported value in a custom
     property does not degrade, it invalidates the property for every rule that
     reads it. The values below are the defaults for --mm-accent; applyAccent()
     recomputes all five in JS whenever the accent changes. Same result, no
     color-mix(). Every caller goes through applyAccent(). */
  --mm-accent-soft:rgba(108,122,224,.18);
  --mm-accent-line:rgba(108,122,224,.45);
  --mm-accent-soft2:rgba(108,122,224,.32);
  --mm-accent-flash:rgba(108,122,224,.45);
  --mm-accent-hi:#a8b1ec;

  /* --- chrome --- */
  --mm-bg-0:#0f1012;
  --mm-bg-1:#16171a;
  --mm-bg-2:#1c1e22;
  --mm-bg-3:#23252a;
  --mm-bg-sunken:#0b0c0e;

  /* --- text --- */
  --mm-text:#8a8f98;
  --mm-text-hi:#e6e8ea;
  --mm-text-dim:#5c616b;

  /* --- lines --- */
  --mm-line-outer:#000000;
  --mm-line:#2a2d33;
  --mm-line-soft:#1f2126;

  /* --- states --- */
  --mm-hover:rgba(255,255,255,.035);
  --mm-active:rgba(255,255,255,.07);
  --mm-stripe:rgba(255,255,255,.014);

  /* --- semantic --- */
  --mm-danger:#d1495b;
  --mm-warn:#d19a3c;
  --mm-ok:#5fa463;
  --mm-info:#5b8bb5;
  --mm-inspect:#35e0e8;

  /* --- type --- */
  --mm-font:Verdana,Tahoma,"Segoe UI",sans-serif;
  --mm-font-mono:Consolas,"Lucida Console","Courier New",monospace;
  --mm-fs:11px;
  --mm-fs-sm:10px;
  --mm-fs-xs:9px;
  --mm-fs-lg:12px;
  --mm-lh:1.25;
  --mm-track:.6px;

  /* --- metrics --- */
  --mm-sp-1:2px;
  --mm-sp-2:4px;
  --mm-sp-3:6px;
  --mm-sp-4:8px;
  --mm-sp-5:12px;
  --mm-row-h:20px;
  --mm-ctl-h:15px;
  --mm-radius:2px;
  --mm-bw:1px;
  --mm-scroll:6px;
  --mm-win-w:700px;
  --mm-win-h:520px;

  --mm-shadow:0 10px 34px rgba(0,0,0,.62), 0 2px 6px rgba(0,0,0,.5);
  --mm-inset:inset 0 0 0 1px var(--mm-line);
  --mm-opacity:1;
  --mm-scale:1;

  position:absolute; left:0; top:0; right:0; bottom:0; overflow:hidden;
  font-family:var(--mm-font); font-size:var(--mm-fs); line-height:var(--mm-lh);
  color:var(--mm-text); -webkit-font-smoothing:antialiased;
  /* A filesystem path has no spaces in it, so soft wrapping alone cannot break
     one and it runs straight out of every note, tooltip and toast that holds
     it. This is the legacy spelling on purpose: overflow-wrap:anywhere is
     Chromium 80 and the floor here is 66. It is inherited, and it only acts
     where wrapping is already allowed — every white-space:nowrap and
     white-space:pre box below is untouched. */
  word-wrap:break-word;
}
#mm-root *{box-sizing:border-box; margin:0; padding:0; font:inherit; color:inherit}
#mm-root button{background:none;border:0;cursor:pointer;font:inherit;color:inherit}
#mm-root input{background:none;border:0;outline:0;font:inherit;color:inherit}
#mm-root ::-webkit-scrollbar{width:var(--mm-scroll);height:var(--mm-scroll)}
#mm-root ::-webkit-scrollbar-track{background:var(--mm-bg-sunken)}
#mm-root ::-webkit-scrollbar-thumb{background:#3a3d44;border:1px solid var(--mm-bg-sunken)}
#mm-root ::-webkit-scrollbar-thumb:hover{background:#4c5058}
#mm-root ::-webkit-scrollbar-corner{background:var(--mm-bg-sunken)}
#mm-root ::selection{background:var(--mm-accent-soft)}

/* ---------- window shell ---------- */
/* FLOOR: min() needs Chromium 79. The height wants min(token, viewport - 96px)
   — a genuine range, so it is the token by default and a media query for the
   one case that needs the other arm. 616px is where min() switched over: the
   520px token plus the 96px of screen it keeps clear. #mm-root fills the host,
   which fills the window, so a viewport query and '100%' measure the same box. */
#mm-root .mm-win{
  position:absolute; width:var(--mm-win-w);
  height:var(--mm-win-h); min-height:300px;
  background:var(--mm-bg-0); border:var(--mm-bw) solid var(--mm-line-outer);
  box-shadow:var(--mm-shadow),var(--mm-inset);
  display:flex; flex-direction:column; overflow:hidden;
  opacity:var(--mm-opacity);
  transform:scale(var(--mm-scale)); transform-origin:0 0;
}
@media (max-height:616px){#mm-root .mm-win{height:calc(100% - 96px)}}
#mm-root .mm-titlebar{
  height:24px; flex:0 0 auto; display:flex; align-items:center;
  padding:0 var(--mm-sp-2) 0 var(--mm-sp-3); cursor:grab;
  background:linear-gradient(#1e2025,#15161a);
  border-bottom:1px solid var(--mm-line-outer);
}
/* FLOOR: flex 'gap' needs Chromium 84. Every horizontal strip below spaces its
   children with '> * + *{margin-left}' instead; every vertical one with
   'margin-top'. The two containers that actually wrap are marked where they
   are — a '+' margin cannot open a gap between wrapped ROWS. */
#mm-root .mm-titlebar>*+*{margin-left:var(--mm-sp-3)}
#mm-root .mm-titlebar.mm-dragging{cursor:grabbing}
/* Brand and version sit on ONE baseline. They are different sizes and
   different families, so centring them in the title bar left the version
   visibly riding above the wordmark's baseline. */
#mm-root .mm-brandwrap{display:flex;align-items:baseline;min-width:0}
#mm-root .mm-brandwrap>*+*{margin-left:var(--mm-sp-3)}
#mm-root .mm-brand{font-size:var(--mm-fs);letter-spacing:1.4px;color:var(--mm-text-hi);font-weight:700;white-space:nowrap}
#mm-root .mm-brand span{color:var(--mm-accent)}
#mm-root .mm-ver{font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);color:var(--mm-text-dim);white-space:nowrap}
#mm-root .mm-title-sep{flex:1}
#mm-root .mm-accent-rule{height:1px;flex:0 0 auto;background:var(--mm-accent);opacity:.85}
#mm-root .mm-icobtn{
  width:16px;height:16px;display:grid;place-items:center;color:var(--mm-text-dim);
  border:1px solid transparent;border-radius:var(--mm-radius);
}
#mm-root .mm-icobtn:hover{background:var(--mm-hover);color:var(--mm-text-hi);border-color:var(--mm-line)}
#mm-root .mm-icobtn.mm-on{color:var(--mm-accent);border-color:var(--mm-accent-line);background:var(--mm-accent-soft)}
#mm-root .mm-icobtn.mm-close:hover{background:rgba(209,73,91,.18);color:#f0a7b0;border-color:rgba(209,73,91,.5)}

/* ---------- tab strip ---------- */
#mm-root .mm-tabs{display:flex;flex:0 0 auto;background:var(--mm-bg-1);border-bottom:1px solid var(--mm-line-outer)}
#mm-root .mm-tab{
  flex:1 1 0; min-width:0; display:flex; flex-direction:column; align-items:center;
  padding:var(--mm-sp-2) 0 var(--mm-sp-1); color:var(--mm-text-dim);
  box-shadow:inset -1px 0 0 var(--mm-line-soft), inset 0 -2px 0 transparent;
}
/* The label is the second child and it is the one .mm-tabs-tight hides, so the
   margin sits on the element that disappears — display:none generates no box,
   so it takes its own margin with it and the icon stays centred. */
#mm-root .mm-tab>*+*{margin-top:1px}
#mm-root .mm-tab:last-child{box-shadow:inset 0 -2px 0 transparent}
#mm-root .mm-tab:hover{background:var(--mm-hover);color:var(--mm-text)}
#mm-root .mm-tab.mm-on{
  background:var(--mm-active); color:var(--mm-text-hi);
  box-shadow:inset -1px 0 0 var(--mm-line-soft), inset 0 -2px 0 var(--mm-accent);
}
/* nowrap + ellipsis: .mm-tab is flex:1 1 0, so every tab added past about ten
   squeezes the labels, and a wrapping label changes the height of the whole
   strip. Clipping one character is recoverable; a strip that grows a second
   row and pushes the body down is not. */
#mm-root .mm-tab-label{font-size:var(--mm-fs-xs);letter-spacing:var(--mm-track);text-transform:uppercase;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
/* Past the point where ellipsis stops distinguishing labels ("VARIA…", "TELEP…")
   the strip drops to icons only. The shell measures and sets this class; the
   tooltip already carries the full name, so nothing is lost but the word. */
#mm-root .mm-tabs.mm-tabs-tight .mm-tab-label{display:none}
#mm-root .mm-tabs.mm-tabs-tight .mm-tab{padding:var(--mm-sp-2) 0}
#mm-root .mm-tab svg{width:14px;height:14px;display:block}

/* ---------- sub tabs ---------- */
/* World carries eleven sub-tabs and they are intrinsically sized, so on a
   narrow window they do not all fit on one line.
   This used to scroll instead of wrap, with the scrollbar hidden to keep the
   header 19px tall. That is the worst of both: the overflowing sub-tabs were
   still reachable, but nothing on screen said so, and a panel scrolled off the
   right edge is indistinguishable from a panel that never registered. Wrapping
   costs one row of header height in exactly the cases where the alternative is
   an invisible feature, so it wraps. */
/* WRAPPING container, so '> * + *' is not enough: it would leave a second row
   of sub-tabs touching the first. Every child takes the spacing on its top and
   left, and the container gives back the same amount out of its own padding —
   the negative-margin technique, folded into padding it already had, because a
   negative margin here would drag the strip up over the tab row and left past
   the window edge. Padding 2/6 becomes 0/4, children add back 2/2. */
#mm-root .mm-subtabs{
  display:flex;flex-wrap:wrap;align-items:center;align-content:center;
  flex:0 0 auto;min-height:19px;padding:0 var(--mm-sp-3) 2px var(--mm-sp-2);
  overflow:hidden;overflow-anchor:none;
  background:var(--mm-bg-0);border-bottom:1px solid var(--mm-line-soft);
}
#mm-root .mm-subtabs>*{margin-top:var(--mm-sp-1);margin-left:var(--mm-sp-1)}
#mm-root .mm-subtab{
  display:flex;align-items:center;height:15px;padding:0 var(--mm-sp-3);
  font-size:var(--mm-fs-sm);color:var(--mm-text-dim);border-radius:var(--mm-radius);
}
/* The dot is opacity:0 when the sub-tab is off, not display:none — it still
   generates a box, so the label sits in the same place either way. */
#mm-root .mm-subtab>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-subtab:hover{background:var(--mm-hover);color:var(--mm-text)}
#mm-root .mm-subtab.mm-on{color:var(--mm-text-hi);background:var(--mm-hover)}
#mm-root .mm-subtab i{width:3px;height:3px;background:var(--mm-accent);opacity:0;display:block}
#mm-root .mm-subtab.mm-on i{opacity:1}
#mm-root .mm-subtabs .mm-title-sep{flex:1 0 auto}
#mm-root .mm-subtab{flex:0 0 auto;white-space:nowrap}
/* The crumb is decoration; it yields its width to the sub-tabs rather than
   pushing one of them onto a second row. */
#mm-root .mm-subtabs .mm-crumb{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
#mm-root .mm-crumb{font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);color:#3f434b;white-space:nowrap}

/* ---------- content ---------- */
#mm-root .mm-body{flex:1 1 auto;min-height:0;display:flex;overflow:hidden}
#mm-root .mm-col{flex:1 1 0;min-width:0;overflow-y:auto;overflow-x:hidden;overflow-anchor:none;padding:var(--mm-sp-3);display:flex;flex-direction:column}
#mm-root .mm-col>*+*{margin-top:var(--mm-sp-3)}
#mm-root .mm-col+.mm-col{border-left:1px solid var(--mm-line-soft)}
/* ---- draggable divider between body columns ---- */
#mm-root .mm-split{
  flex:0 0 5px;align-self:stretch;cursor:col-resize;position:relative;z-index:3;
  margin:0 -2px;background:transparent;
}
#mm-root .mm-split::after{content:"";position:absolute;left:2px;top:0;bottom:0;width:1px;background:transparent}
#mm-root .mm-split:hover::after,#mm-root .mm-split.mm-dragging::after{background:var(--mm-accent)}
#mm-root .mm-col-narrow{flex:0 0 210px}

/* ---------- groupbox ---------- */
#mm-root .mm-group{border:1px solid var(--mm-line);background:var(--mm-bg-1);flex:0 0 auto}
#mm-root .mm-group.mm-grow{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
#mm-root .mm-group-hd{
  display:flex;align-items:center;height:17px;padding:0 var(--mm-sp-3);
  background:var(--mm-bg-2);border-bottom:1px solid var(--mm-line);
  font-size:var(--mm-fs-xs);letter-spacing:1px;text-transform:uppercase;color:var(--mm-text-dim);
}
#mm-root .mm-group-hd>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-group-hd:hover{color:var(--mm-text)}
#mm-root .mm-group-hd .mm-caret{width:5px;height:5px;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(45deg);margin-bottom:2px;transition:transform .1s}
#mm-root .mm-group.mm-collapsed .mm-caret{transform:rotate(-45deg)}
#mm-root .mm-group.mm-collapsed .mm-group-bd{display:none}
#mm-root .mm-group-bd{padding:var(--mm-sp-2) var(--mm-sp-3);display:flex;flex-direction:column}
#mm-root .mm-group-bd>*+*{margin-top:1px}
#mm-root .mm-group.mm-grow .mm-group-bd{flex:1 1 auto;min-height:0;overflow:hidden;padding:0}
/* Only the FIRST tag takes the auto margin. A panel that appends a live tag
   next to a declared one gave two elements the same auto margin, and the pair
   overlapped instead of sitting side by side. */
#mm-root .mm-group-tag{margin-left:auto;flex:0 0 auto;white-space:nowrap;font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);color:#3f434b;letter-spacing:0}
/* The auto margin has to outrank the '> * + *' row-spacing rules that replaced
   'gap'. They have the same specificity, so whichever comes later in the sheet
   would win — and a tag lives inside several different headers, declared both
   above and below this line. The doubled class settles it regardless of order:
   without it the tag stops floating right and sits against the title. */
#mm-root .mm-group-tag.mm-group-tag{margin-left:auto}
#mm-root .mm-group-tag~.mm-group-tag{margin-left:var(--mm-sp-2)}
/* ...and the title yields before either of them does. */
#mm-root .mm-group-hd>span:not(.mm-group-tag){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---------- row ---------- */
#mm-root .mm-row{display:flex;align-items:center;min-height:var(--mm-row-h);padding:0 var(--mm-sp-1)}
#mm-root .mm-row>*+*{margin-left:var(--mm-sp-3)}
#mm-root .mm-row:hover{background:var(--mm-hover)}
#mm-root .mm-row.mm-off{opacity:.42;pointer-events:none}
#mm-root .mm-lab{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--mm-fs-sm);color:var(--mm-text)}
#mm-root .mm-row:hover .mm-lab{color:var(--mm-text-hi)}
#mm-root .mm-sub{font-size:var(--mm-fs-xs);color:var(--mm-text-dim)}
#mm-root .mm-edge{display:flex;align-items:center;flex:0 0 auto}
#mm-root .mm-edge>*+*{margin-left:var(--mm-sp-1)}
/* .mm-edge itself must stay flex:0 0 auto — a button, stepper, keybind or
   swatch in an edge must never be squeezed to fit a long label. A row that puts
   a STRING there opts in instead. The large shrink factor makes the edge, not
   the label, absorb the whole deficit. */
#mm-root .mm-edge--shrink{flex:0 100 auto;min-width:0}
#mm-root .mm-edge--wrap{white-space:normal;text-align:right}
/* Ellipsised from the MIDDLE, in JS, by measurement: text-overflow keeps the
   head, and the head of a path is the half that says nothing. */
#mm-root .mm-path{
  display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  user-select:text;-webkit-user-select:text;cursor:text;
}
#mm-root .mm-sep{height:1px;background:var(--mm-line-soft)}
/* A separator's own spacing and its container's row spacing are now the same
   property, so one of them has to win outright rather than adding up as margin
   plus gap did. The doubled class makes it the separator's, everywhere: a
   uniform 4px above and below whichever kind of stack it is dropped into. */
#mm-root .mm-sep.mm-sep{margin-top:var(--mm-sp-2);margin-bottom:var(--mm-sp-2)}
#mm-root .mm-stack{display:flex;flex-direction:column}
#mm-root .mm-stack>*+*{margin-top:var(--mm-sp-2)}
/* Tighter stack, for popup bodies that were built with an inline gap:1px. */
#mm-root .mm-stack-tight{display:flex;flex-direction:column}
#mm-root .mm-stack-tight>*+*{margin-top:1px}
/* WRAPPING container, and the only primitive that wraps by design — a strip of
   chips or swatches in a narrow column runs onto a second row routinely. The
   spacing therefore goes on the trailing edge of EVERY child, so wrapped rows
   are spaced too, and the container cancels the row that trails off the bottom
   with a matching negative margin. Net height and net position are unchanged,
   which is what keeps it safe inside an align-items:center parent. */
#mm-root .mm-inline{display:flex;align-items:center;flex-wrap:wrap;margin-bottom:calc(var(--mm-sp-2) * -1)}
#mm-root .mm-inline>*{margin-right:var(--mm-sp-2);margin-bottom:var(--mm-sp-2)}
#mm-root .mm-inline>*:last-child{margin-right:0}
#mm-root .mm-mono{font-family:var(--mm-font-mono)}
#mm-root .mm-hi{color:var(--mm-text-hi)}
#mm-root .mm-acc{color:var(--mm-accent)}

/* ---------- checkbox ---------- */
#mm-root .mm-check{width:11px;height:11px;flex:0 0 auto;background:var(--mm-bg-sunken);border:1px solid #3a3d44;position:relative;border-radius:1px}
#mm-root .mm-check:hover{border-color:#565b64}
#mm-root .mm-check.mm-on{background:var(--mm-accent);border-color:var(--mm-accent)}
/* Centred on the box rather than nudged with magic offsets. The extra -8%
   on Y compensates for the rotated L sitting low in its own border box —
   without it the tick reads as sunk toward the bottom-left corner. */
#mm-root .mm-check.mm-on::after{
  content:"";position:absolute;left:50%;top:50%;width:5px;height:2.5px;
  border-left:1.5px solid #fff;border-bottom:1.5px solid #fff;
  transform:translate(-50%,-58%) rotate(-45deg);
}
#mm-root .mm-check.mm-dis{opacity:.4;pointer-events:none}
#mm-root .mm-cbrow{display:flex;align-items:center;min-height:var(--mm-row-h);padding:0 var(--mm-sp-1);cursor:pointer}
#mm-root .mm-cbrow>*+*{margin-left:var(--mm-sp-3)}
#mm-root .mm-cbrow:hover{background:var(--mm-hover)}
#mm-root .mm-cbrow:hover .mm-lab{color:var(--mm-text-hi)}

/* ---------- slider ---------- */
#mm-root .mm-slider{display:flex;align-items:center;flex:0 0 auto;width:132px}
#mm-root .mm-slider>*+*{margin-left:var(--mm-sp-3)}
#mm-root .mm-slider-track{position:relative;flex:1 1 auto;height:3px;background:var(--mm-bg-sunken);box-shadow:inset 0 0 0 1px #000;cursor:ew-resize}
#mm-root .mm-slider-fill{position:absolute;top:0;bottom:0;left:0;right:auto;background:var(--mm-accent)}
#mm-root .mm-slider-knob{position:absolute;top:-4px;width:4px;height:11px;background:#c3c8d0;margin-left:-2px;box-shadow:0 0 0 1px #000}
#mm-root .mm-slider:hover .mm-slider-knob{background:#fff}
#mm-root .mm-slider.mm-dis{opacity:.4;pointer-events:none}
#mm-root .mm-numbox{
  width:42px;flex:0 0 auto;height:var(--mm-ctl-h);background:var(--mm-bg-sunken);border:1px solid var(--mm-line);
  font-family:var(--mm-font-mono);font-size:var(--mm-fs-sm);color:var(--mm-text-hi);text-align:center;
}
#mm-root .mm-numbox:focus{border-color:var(--mm-accent);box-shadow:0 0 0 1px var(--mm-accent-soft)}

/* ---------- number stepper ---------- */
#mm-root .mm-num{display:flex;align-items:stretch;height:var(--mm-ctl-h);flex:0 0 auto;border:1px solid var(--mm-line);background:var(--mm-bg-sunken)}
#mm-root .mm-num input{width:38px;text-align:center;font-family:var(--mm-font-mono);font-size:var(--mm-fs-sm);color:var(--mm-text-hi)}
#mm-root .mm-num .mm-step{width:13px;display:grid;place-items:center;color:var(--mm-text-dim);font-size:var(--mm-fs-sm);background:var(--mm-bg-2);user-select:none}
#mm-root .mm-num .mm-step:hover{background:var(--mm-bg-3);color:var(--mm-text-hi)}
#mm-root .mm-num .mm-step:active{background:var(--mm-accent);color:#fff}
#mm-root .mm-num.mm-focus{border-color:var(--mm-accent);box-shadow:0 0 0 1px var(--mm-accent-soft)}
#mm-root .mm-num.mm-dis{opacity:.4;pointer-events:none}
#mm-root .mm-num-wide input{width:56px}

/* ---------- text input ---------- */
#mm-root .mm-input{
  height:var(--mm-ctl-h);background:var(--mm-bg-sunken);border:1px solid var(--mm-line);
  padding:0 var(--mm-sp-2);font-size:var(--mm-fs-sm);color:var(--mm-text-hi);min-width:0;
}
#mm-root .mm-textarea{
  font:inherit;font-size:var(--mm-fs-sm);color:var(--mm-text);background:var(--mm-bg-2);
  border:1px solid var(--mm-line);border-radius:var(--mm-radius);padding:2px 4px;
  resize:vertical;min-height:30px;max-height:120px;width:100%;line-height:1.45;
}
#mm-root .mm-textarea:focus{border-color:var(--mm-accent);outline:none}
#mm-root .mm-input::placeholder{color:#4a4e56}
#mm-root .mm-input:hover{border-color:#3a3d44}
#mm-root .mm-input:focus{border-color:var(--mm-accent);box-shadow:0 0 0 1px var(--mm-accent-soft)}
#mm-root .mm-input.mm-mono{font-family:var(--mm-font-mono)}
#mm-root textarea.mm-input{height:auto;padding:var(--mm-sp-2);resize:none;line-height:1.35}
#mm-root .mm-search{display:flex;align-items:center;height:17px;padding:0 var(--mm-sp-2);background:var(--mm-bg-sunken);border:1px solid var(--mm-line);flex:1 1 auto;min-width:0}
#mm-root .mm-search>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-search:focus-within{border-color:var(--mm-accent);box-shadow:0 0 0 1px var(--mm-accent-soft)}
#mm-root .mm-search input{flex:1 1 auto;min-width:0;font-size:var(--mm-fs-sm);color:var(--mm-text-hi)}
#mm-root .mm-search svg{width:9px;height:9px;color:var(--mm-text-dim);flex:0 0 auto}

/* ---------- dropdown ---------- */
#mm-root .mm-dd{position:relative;flex:0 0 auto;width:118px}
/* An open dropdown has to out-paint the table that follows it in the same
   group; without a stacking context of its own the later sibling wins and the
   panel renders underneath the rows. */
#mm-root .mm-dd.mm-open{z-index:50}
#mm-root .mm-dd-btn{
  display:flex;align-items:center;width:100%;height:var(--mm-ctl-h);
  padding:0 var(--mm-sp-2);background:var(--mm-bg-2);border:1px solid var(--mm-line);
  font-size:var(--mm-fs-sm);color:var(--mm-text-hi);
}
/* margin-left only: .mm-dd-arrow carries a margin-top of its own to sit on the
   text baseline, and a 'margin' shorthand here would wipe it out. Every rule
   that replaced a 'gap' in this sheet uses long-hand for that reason. */
#mm-root .mm-dd-btn>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-dd-btn span{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
#mm-root .mm-dd-btn:hover{background:var(--mm-bg-3);border-color:#3a3d44}
#mm-root .mm-dd.mm-open .mm-dd-btn{border-color:var(--mm-accent-line);background:var(--mm-bg-3)}
#mm-root .mm-dd-arrow{width:0;height:0;border:3px solid transparent;border-top-color:var(--mm-text-dim);margin-top:3px;flex:0 0 auto}
#mm-root .mm-dd-panel{
  position:absolute;z-index:40;top:calc(100% + 1px);left:0;right:auto;
  min-width:100%;width:max-content;max-width:260px;max-height:150px;overflow-y:auto;overflow-x:hidden;overflow-anchor:none;
  background:var(--mm-bg-1);border:1px solid var(--mm-line-outer);box-shadow:var(--mm-shadow),var(--mm-inset);display:none;
}
#mm-root .mm-dd.mm-open .mm-dd-panel{display:block}
#mm-root .mm-dd-up .mm-dd-panel{top:auto;bottom:calc(100% + 1px)}
#mm-root .mm-opt{display:flex;align-items:center;height:17px;flex:0 0 auto;padding:0 var(--mm-sp-2);font-size:var(--mm-fs-sm);color:var(--mm-text)}
#mm-root .mm-opt>*+*{margin-left:var(--mm-sp-2)}
/* Fixed-height options, so a long label must ellipsis rather than wrap onto
   the option below it. */
#mm-root .mm-opt>span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mm-root .mm-opt:hover{background:var(--mm-accent-soft);color:var(--mm-text-hi)}
#mm-root .mm-opt.mm-on{color:var(--mm-text-hi)}
#mm-root .mm-opt-tick{width:7px;flex:0 0 auto;color:var(--mm-accent);font-size:var(--mm-fs-xs);text-align:center}
#mm-root .mm-dd-dis{opacity:.4;pointer-events:none}

/* ---------- keybind ---------- */
#mm-root .mm-kb{
  min-width:17px;height:13px;padding:0 3px;flex:0 0 auto;display:grid;place-items:center;
  background:var(--mm-bg-2);border:1px solid var(--mm-line);
  font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);color:var(--mm-text-dim);letter-spacing:0;
}
#mm-root .mm-kb:hover{border-color:#3a3d44;color:var(--mm-text)}
#mm-root .mm-kb.mm-set{color:var(--mm-accent);border-color:var(--mm-accent-line)}
#mm-root .mm-kb.mm-listen{color:var(--mm-text-hi);border-color:var(--mm-accent);background:var(--mm-accent-soft)}
#mm-root .mm-pop{
  position:absolute;z-index:60;background:var(--mm-bg-1);border:1px solid var(--mm-line-outer);
  box-shadow:var(--mm-shadow),var(--mm-inset);padding:var(--mm-sp-2);display:flex;flex-direction:column;
}
#mm-root .mm-pop>*+*{margin-top:1px}
#mm-root .mm-pop-hd{font-size:var(--mm-fs-xs);letter-spacing:1px;text-transform:uppercase;color:var(--mm-text-dim);padding:0 var(--mm-sp-1) var(--mm-sp-1)}
#mm-root .mm-pop-opt{display:flex;align-items:center;height:16px;padding:0 var(--mm-sp-1);font-size:var(--mm-fs-sm)}
#mm-root .mm-pop-opt>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-pop-opt:hover{background:var(--mm-hover);color:var(--mm-text-hi)}
#mm-root .mm-radio{width:7px;height:7px;border:1px solid #3a3d44;border-radius:50%;flex:0 0 auto;position:relative}
#mm-root .mm-pop-opt.mm-on .mm-radio{border-color:var(--mm-accent)}
#mm-root .mm-pop-opt.mm-on .mm-radio::after{content:"";position:absolute;left:1.5px;top:1.5px;right:1.5px;bottom:1.5px;border-radius:50%;background:var(--mm-accent)}
#mm-root .mm-pop-opt.mm-on{color:var(--mm-text-hi)}

/* ---------- colour picker ---------- */
#mm-root .mm-sw{width:16px;height:11px;flex:0 0 auto;border:1px solid #000;box-shadow:0 0 0 1px #3a3d44}
#mm-root .mm-sw:hover{box-shadow:0 0 0 1px #6a6f78}
#mm-root .mm-sv{position:relative;width:118px;height:76px;cursor:crosshair;border:1px solid #000}
#mm-root .mm-hue{position:relative;width:118px;height:8px;cursor:ew-resize;border:1px solid #000;
  background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
#mm-root .mm-dot{position:absolute;width:7px;height:7px;border:1px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #000;transform:translate(-50%,-50%);pointer-events:none}
#mm-root .mm-hue-dot{position:absolute;top:-2px;width:3px;height:calc(100% + 4px);background:#fff;box-shadow:0 0 0 1px #000;transform:translateX(-50%);pointer-events:none}

/* ---------- buttons ---------- */
#mm-root .mm-btn{
  height:var(--mm-ctl-h);padding:0 var(--mm-sp-3);flex:0 0 auto;display:inline-flex;align-items:center;
  background:var(--mm-bg-2);border:1px solid var(--mm-line);color:var(--mm-text);
  font-size:var(--mm-fs-sm);border-radius:var(--mm-radius);white-space:nowrap;
}
/* A button's label is set as text, so the usual case has no element children at
   all and nothing to space. The rule is here for the callers that push an icon
   in beside the label. */
#mm-root .mm-btn>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-btn:hover{background:var(--mm-bg-3);color:var(--mm-text-hi);border-color:#3a3d44}
#mm-root .mm-btn:active{background:var(--mm-accent-soft);border-color:var(--mm-accent-line);color:var(--mm-text-hi)}
#mm-root .mm-btn.mm-on{background:var(--mm-accent-soft);border-color:var(--mm-accent-line);color:var(--mm-text-hi)}
#mm-root .mm-btn.mm-dis{opacity:.4;pointer-events:none}
#mm-root .mm-btn-wide{flex:1 1 auto;justify-content:center}
#mm-root .mm-btn-tall{height:18px}
#mm-root .mm-btn-danger{color:#c2707c;border-color:#3a2a2e;background:#1a1416}
#mm-root .mm-btn-danger:hover{color:#f0b3bb;background:rgba(209,73,91,.14);border-color:rgba(209,73,91,.45)}
#mm-root .mm-btn-danger.mm-armed{background:var(--mm-danger);border-color:#e8677a;color:#fff}
#mm-root .mm-btn-danger.mm-armed:hover{background:#e05366;color:#fff}
#mm-root .mm-btn-prime{color:var(--mm-text-hi);border-color:var(--mm-accent-line);background:var(--mm-accent-soft)}
#mm-root .mm-btn-prime:hover{background:var(--mm-accent-soft2)}
#mm-root .mm-chip{
  height:14px;padding:0 var(--mm-sp-2);display:inline-flex;align-items:center;
  background:var(--mm-bg-2);border:1px solid var(--mm-line);color:var(--mm-text-dim);
  font-size:var(--mm-fs-xs);letter-spacing:var(--mm-track);text-transform:uppercase;border-radius:var(--mm-radius);
}
#mm-root .mm-chip:hover{color:var(--mm-text);border-color:#3a3d44}
#mm-root .mm-chip.mm-on{color:var(--mm-text-hi);border-color:var(--mm-accent-line);background:var(--mm-accent-soft)}

/* ---------- table ---------- */
#mm-root .mm-table{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;background:var(--mm-bg-sunken)}
#mm-root .mm-thead{
  display:flex;flex:0 0 auto;height:16px;background:var(--mm-bg-2);border-bottom:1px solid var(--mm-line-outer);
  font-size:var(--mm-fs-xs);letter-spacing:var(--mm-track);text-transform:uppercase;color:var(--mm-text-dim);
}
#mm-root .mm-tbody{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overflow-anchor:none;overscroll-behavior:contain}
/* THE runaway-scroll fix.

   Chromium's scroll anchoring (on by default since 56) watches for DOM changes
   above the current scroll offset and silently adjusts scrollTop to keep the
   anchored element visually still. A virtualised list changes exactly that on
   every scroll event — it swaps its rows and resizes the spacers — so the
   browser compensates, the compensation fires another scroll event, that
   re-renders, and it compounds. Five 100px wheel ticks travelled 11563px and
   kept moving half a second after the input stopped.

   Disabling anchoring on the scroller and its children makes the same gesture
   land on exactly 500px. Every scroll container in the overlay gets it: none of
   them ever wants the browser second-guessing their offset. */
#mm-root .mm-tbody > *{overflow-anchor:none}
#mm-root .mm-tr{display:flex;height:17px;align-items:center;border-bottom:1px solid #131417}
#mm-root .mm-tbody .mm-tr:nth-child(even){background:var(--mm-stripe)}
#mm-root .mm-tbody .mm-tr:hover{background:var(--mm-hover)}
#mm-root .mm-tbody .mm-tr.mm-on{background:var(--mm-accent-soft)}
#mm-root .mm-td{padding:0 var(--mm-sp-2);overflow:hidden;white-space:nowrap;font-size:var(--mm-fs-sm);display:flex;align-items:center;position:relative}
#mm-root .mm-td>*+*{margin-left:var(--mm-sp-2)}
/* The resize grip is an absolutely positioned last child of a header cell. It
   is out of flow, so 'gap' never reached it; '> * + *' does, and a margin on a
   box pinned by 'right' only muddies the solved 'left'. Zero it explicitly. */
#mm-root .mm-td>.mm-colgrip{margin-left:0}
/* text-overflow needs a block box with inline content. .mm-td is a flex
   container, so its anonymous text item can never ellipsise — it just gets
   cut off mid-word. Cell text is wrapped in .mm-cell for exactly this. */
#mm-root .mm-cell{min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mm-root .mm-td>span,#mm-root .mm-td>b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mm-root .mm-td-num{font-family:var(--mm-font-mono);color:var(--mm-text-dim)}
#mm-root .mm-td-val{font-family:var(--mm-font-mono);color:var(--mm-text-hi)}
/* ---- column resize grips ----
   NOT .mm-grip: that name is already the window's bottom-right resize handle,
   which carries a diagonal hatch background — reusing it painted hatch marks
   across every column boundary in every header. */
#mm-root .mm-thead .mm-td{position:relative}
#mm-root .mm-colgrip{
  position:absolute;right:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:2;
}
#mm-root .mm-colgrip::after{content:"";position:absolute;left:3px;top:2px;bottom:2px;width:1px;background:transparent}
#mm-root .mm-colgrip:hover::after,#mm-root .mm-colgrip.mm-dragging::after{background:var(--mm-accent)}
#mm-root .mm-tr.mm-flash{background:var(--mm-accent-soft);animation:mm-fade 2s linear forwards}
@keyframes mm-fade{from{background:var(--mm-accent-flash)}to{background:transparent}}
#mm-root .mm-cellinput{width:100%;font-family:var(--mm-font-mono);font-size:var(--mm-fs-sm);color:var(--mm-text-hi);background:#000;border:1px solid var(--mm-accent);height:14px;padding:0 3px}
#mm-root .mm-empty{padding:var(--mm-sp-4);text-align:center;font-size:var(--mm-fs-sm);color:#3f434b}
/* WRAPPING container — a search box plus four chips runs onto a second row in a
   narrow column. Same treatment as .mm-subtabs: spacing on the top and left of
   every child, given back out of the padding the toolbar already had, so the
   first child lands where it always did (2px padding + 4px margin = the old
   6px) and wrapped rows are 4px apart. A negative margin would instead pull the
   toolbar up over the row above it and left past its own border. */
#mm-root .mm-toolbar{display:flex;align-items:center;padding:0 var(--mm-sp-3) var(--mm-sp-2) var(--mm-sp-1);border-bottom:1px solid var(--mm-line);flex:0 0 auto;flex-wrap:wrap}
#mm-root .mm-toolbar>*{margin-top:var(--mm-sp-2);margin-left:var(--mm-sp-2)}
/* Buttons living inside a 17px table row. The default .mm-inline wraps, which
   inside a fixed-height cell means the second line is clipped and the first
   sits off-centre — so cell button groups never wrap and the buttons shrink. */
#mm-root .mm-cellbtns{display:flex;align-items:center;flex-wrap:nowrap;overflow:hidden}
#mm-root .mm-cellbtns>*+*{margin-left:2px}
/* Tree twisty. A real button with a 14px hit area rather than a 5px glyph, so
   folding a branch does not require pixel-hunting. */
#mm-root .mm-twisty{
  width:14px;height:14px;flex:0 0 auto;display:grid;place-items:center;
  color:var(--mm-text-dim);border-radius:var(--mm-radius);
}
#mm-root .mm-twisty:hover{background:var(--mm-hover);color:var(--mm-text-hi)}
#mm-root .mm-twisty::before{
  content:"";width:0;height:0;
  border-top:3.5px solid transparent;border-bottom:3.5px solid transparent;
  border-left:5px solid currentColor;margin-left:2px;
}
#mm-root .mm-twisty.mm-open::before{
  border-left:3.5px solid transparent;border-right:3.5px solid transparent;
  border-top:5px solid currentColor;border-bottom:0;margin-left:0;margin-top:2px;
}
#mm-root .mm-twisty-none{width:14px;height:14px;flex:0 0 auto;display:block}
#mm-root .mm-btn-mini{height:13px;padding:0 4px;font-size:var(--mm-fs-xs);letter-spacing:0}
/* Sized to sit inside a 20px row without changing its height. */
#mm-root .mm-copy{
  flex:0 0 auto;width:13px;height:13px;display:grid;place-items:center;
  background:var(--mm-bg-2);border:1px solid var(--mm-line);border-radius:var(--mm-radius);
  color:var(--mm-text-dim);font-size:var(--mm-fs-xs);line-height:1;
}
#mm-root .mm-copy:hover{background:var(--mm-bg-3);color:var(--mm-text-hi);border-color:#3a3d44}
#mm-root .mm-copy.mm-ok{color:var(--mm-ok);border-color:var(--mm-ok)}

/* ---------- misc dressing ---------- */
#mm-root .mm-bar{height:4px;background:var(--mm-bg-sunken);box-shadow:inset 0 0 0 1px #000;flex:1 1 auto;position:relative;overflow:hidden}
#mm-root .mm-bar i{position:absolute;top:0;bottom:0;left:0;right:auto;display:block;background:var(--mm-ok)}
#mm-root .mm-card{border:1px solid var(--mm-line);background:var(--mm-bg-2);padding:var(--mm-sp-2) var(--mm-sp-3);display:flex;flex-direction:column}
#mm-root .mm-card>*+*{margin-top:var(--mm-sp-2)}
#mm-root .mm-tree-row{display:flex;align-items:center;width:100%;height:16px;flex:0 0 auto;white-space:nowrap;overflow:hidden;text-align:left;font-size:var(--mm-fs-sm);color:var(--mm-text);padding:0 var(--mm-sp-2) 0 var(--mm-sp-1)}
#mm-root .mm-tree-row>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-tree-row>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
#mm-root .mm-tree-row:hover{background:var(--mm-hover);color:var(--mm-text-hi)}
#mm-root .mm-tree-row.mm-on{background:var(--mm-accent-soft);color:var(--mm-text-hi)}
#mm-root .mm-tree-row.mm-dir{color:var(--mm-text-dim);text-transform:uppercase;font-size:var(--mm-fs-xs);letter-spacing:var(--mm-track)}
#mm-root .mm-dotmark{width:4px;height:4px;flex:0 0 auto;background:currentColor}
#mm-root .mm-icocell{width:14px;height:14px;flex:0 0 auto;border:1px solid #000;box-shadow:0 0 0 1px #2a2d33}
/* Ten to a row, 2px apart, without 'gap' — which the floor lacks for grid as
   well as for flex (grid picked it up in 66, flex not until 84, and the older
   grid-gap spelling is the same token to anything linting for it). Flex-wrap
   plus a trailing margin gives each cell a 10% slot with the spacing inside
   it, so the count per row is the same at any container width. */
#mm-root .mm-icogrid{display:flex;flex-wrap:wrap}
#mm-root .mm-icogrid>*{flex:0 0 auto;width:calc(10% - 2px);margin-right:2px;margin-bottom:2px}
#mm-root .mm-icogrid button{height:18px;border:1px solid #000;box-shadow:0 0 0 1px #23252a}
#mm-root .mm-icogrid button:hover{box-shadow:0 0 0 1px #6a6f78}
#mm-root .mm-icogrid button.mm-on{box-shadow:0 0 0 1px var(--mm-accent),0 0 0 2px var(--mm-accent-soft)}
#mm-root .mm-legend{display:flex;align-items:center;font-size:var(--mm-fs-xs);color:var(--mm-text-dim)}
#mm-root .mm-legend>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-legend i{width:7px;height:7px;display:block;border:1px solid #000}

/* ---------- log drawer ---------- */
#mm-root .mm-log{flex:0 0 auto;border-top:1px solid var(--mm-line-outer);background:var(--mm-bg-1)}
#mm-root .mm-log-hd{display:flex;align-items:center;height:16px;padding:0 var(--mm-sp-3);font-size:var(--mm-fs-xs);letter-spacing:1px;text-transform:uppercase;color:var(--mm-text-dim)}
/* The line-count tag is the last child here and keeps its auto margin — see the
   doubled-class rule up in the groupbox section for why that needs saying. */
#mm-root .mm-log-hd>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-log-hd:hover{color:var(--mm-text)}
#mm-root .mm-log-bd{height:78px;overflow-y:auto;overflow-anchor:none;background:var(--mm-bg-sunken);border-top:1px solid var(--mm-line)}
#mm-root .mm-log.mm-collapsed .mm-log-bd{display:none}
#mm-root .mm-log-row{display:flex;padding:1px var(--mm-sp-3);font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);line-height:1.5}
#mm-root .mm-log-row>*+*{margin-left:var(--mm-sp-3)}
#mm-root .mm-log-row:hover{background:var(--mm-hover)}
#mm-root .mm-log-t{color:#3f434b;flex:0 0 auto}
#mm-root .mm-log-s{flex:0 0 44px;text-transform:uppercase}
#mm-root .mm-log-m{flex:1 1 auto;color:var(--mm-text);word-break:break-word}
#mm-root .mm-sev-info{color:var(--mm-info)}
#mm-root .mm-sev-ok{color:var(--mm-ok)}
#mm-root .mm-sev-warn{color:var(--mm-warn)}
#mm-root .mm-sev-err{color:var(--mm-danger)}

/* ---------- footer ---------- */
#mm-root .mm-footer{
  flex:0 0 auto;height:18px;display:flex;align-items:center;padding:0 var(--mm-sp-3);
  background:linear-gradient(#15161a,#101114);border-top:1px solid var(--mm-line-outer);
  font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);color:var(--mm-text-dim);
  padding-right:16px;
}
#mm-root .mm-footer>*+*{margin-left:var(--mm-sp-4)}
#mm-root .mm-footer b{color:var(--mm-text);font-weight:400}
#mm-root .mm-footer kbd{background:var(--mm-bg-2);border:1px solid var(--mm-line);padding:0 3px;color:var(--mm-text)}
/* FLOOR: 'colour pos1 pos2' in a gradient — one stop declaring both its edges —
   is CSS Images 4 and needs Chromium 72. Below that the whole gradient is
   invalid and the grip loses its hatching, which is the only thing that says
   the corner can be dragged. Written out one stop per edge, which is CSS3. */
#mm-root .mm-grip{
  position:absolute;right:0;bottom:0;width:12px;height:12px;cursor:nwse-resize;z-index:5;
  background:repeating-linear-gradient(-45deg,transparent 0,transparent 2px,#4c5058 2px,#4c5058 3px);
}

/* ---------- tooltip ---------- */
#mm-root .mm-tip{
  position:absolute;z-index:90;max-width:190px;padding:3px var(--mm-sp-2);pointer-events:none;
  background:#08090a;border:1px solid var(--mm-line);color:var(--mm-text);
  font-size:var(--mm-fs-sm);box-shadow:0 4px 12px rgba(0,0,0,.5);
  /* Without these the ink paints outside the box AND offsetWidth over-reports,
     so the placement clamp positions the tip as though it fitted. */
  overflow:hidden;word-wrap:break-word;
}
#mm-root .mm-tip b{display:block;color:var(--mm-text-hi);font-weight:400}

/* ---------- toasts ---------- */
#mm-root .mm-toasts{position:absolute;right:10px;bottom:34px;z-index:80;display:flex;flex-direction:column;align-items:flex-end}
#mm-root .mm-toasts>*+*{margin-top:var(--mm-sp-2)}
#mm-root .mm-toast{
  width:206px;background:var(--mm-bg-1);border:1px solid var(--mm-line-outer);
  box-shadow:var(--mm-shadow),var(--mm-inset);overflow:hidden;animation:mm-in .14s ease-out;
}
#mm-root .mm-toast.mm-out{animation:mm-out .16s ease-in forwards}
@keyframes mm-in{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
@keyframes mm-out{to{opacity:0;transform:translateX(10px)}}
#mm-root .mm-toast-bd{display:flex;padding:var(--mm-sp-3)}
#mm-root .mm-toast-bd>*+*{margin-left:var(--mm-sp-3)}
/* A flex item's automatic minimum size is its min-content width, which for an
   unbreakable path is the whole path — so without this the text block cannot
   shrink inside the toast and is simply clipped. */
#mm-root .mm-toast-bd>*{min-width:0}
#mm-root .mm-toast-bar{width:2px;flex:0 0 auto;background:var(--mm-accent)}
#mm-root .mm-toast-t{font-size:var(--mm-fs-sm);color:var(--mm-text-hi);letter-spacing:var(--mm-track)}
#mm-root .mm-toast-m{font-size:var(--mm-fs-xs);color:var(--mm-text);margin-top:1px}
#mm-root .mm-toast-prog{height:1px;background:var(--mm-accent);animation:mm-prog linear forwards}
@keyframes mm-prog{from{width:100%}to{width:0%}}

/* ---------- floating widgets ---------- */
/* --mm-scale is not the main window's alone: the watch panel, the
   active-cheats HUD and the toasts are the same overlay and have to grow with
   it, or raising the scale leaves three unreadable islands around a large
   window. transform-origin is the element's own corner, so each stays anchored
   where it was dropped. */
#mm-root .mm-float{
  position:absolute;background:var(--mm-bg-0);border:1px solid var(--mm-line-outer);
  box-shadow:var(--mm-shadow),var(--mm-inset);opacity:var(--mm-opacity);overflow:hidden;
  transform:scale(var(--mm-scale)); transform-origin:0 0;
}
#mm-root .mm-float-hd{
  display:flex;align-items:center;height:16px;padding:0 var(--mm-sp-2);cursor:grab;
  background:linear-gradient(#1e2025,#15161a);border-bottom:1px solid var(--mm-line-outer);
  font-size:var(--mm-fs-xs);letter-spacing:1px;text-transform:uppercase;color:var(--mm-text-dim);
}
#mm-root .mm-float-hd>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-watch{width:158px}
#mm-root .mm-watch-bd{padding:var(--mm-sp-1) 0;overflow-anchor:none}
#mm-root .mm-watch-row{display:flex;align-items:center;height:15px;padding:0 var(--mm-sp-2);font-size:var(--mm-fs-xs);font-family:var(--mm-font-mono)}
#mm-root .mm-watch-row>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-watch-row:hover{background:var(--mm-hover)}
#mm-root .mm-watch-row span:first-child{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mm-text)}
#mm-root .mm-watch-row span:last-child{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mm-text-hi)}
/* Anchored by its right edge, so it must grow LEFTWARD. Scaling a right-anchored box
   about its own top-left corner pushes it off the screen edge, which is
   exactly what raising the UI scale did to it. */
#mm-root .mm-hud{position:absolute;z-index:20;display:flex;flex-direction:column;pointer-events:none;
  transform:scale(var(--mm-scale)); transform-origin:100% 0}
#mm-root .mm-hud>*+*{margin-top:1px}
#mm-root .mm-hud-row{display:flex;align-items:center;font-family:var(--mm-font-mono);font-size:var(--mm-fs-sm);color:var(--mm-text-hi);text-shadow:none}
/* The label beside the dot is a bare text node — an anonymous flex item, which
   has no box of its own and cannot take a margin, so '> * + *' never reaches
   it. The dot carries the spacing on its own side instead, and hands it back
   when the sibling IS an element so the two do not add up. This is the case
   the '> * + *' idiom quietly gets wrong; it is worth checking per container. */
#mm-root .mm-hud-row>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-hud-row>i{margin-right:var(--mm-sp-2)}
#mm-root .mm-hud-row>i+*{margin-left:0}
#mm-root .mm-hud-row i{width:4px;height:4px;background:var(--mm-accent);display:block}
#mm-root .mm-hud-row s{text-decoration:none;color:var(--mm-text-dim)}

/* ---------- inspect mode ---------- */
#mm-root .mm-inspect{position:absolute;left:0;top:0;right:0;bottom:0;z-index:70;background:rgba(4,6,8,.5);cursor:crosshair}
#mm-root .mm-inspect-rect{position:absolute;border:1px solid var(--mm-inspect);background:rgba(53,224,232,.07);pointer-events:none}
#mm-root .mm-inspect-rect::after{
  content:attr(data-mm-tag);position:absolute;left:-1px;top:-13px;height:12px;padding:0 3px;
  background:var(--mm-inspect);color:#03181a;font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);
  display:flex;align-items:center;letter-spacing:0;
}
#mm-root .mm-inspect-tip{
  position:absolute;z-index:75;width:206px;background:#08090a;border:1px solid var(--mm-inspect);
  box-shadow:0 6px 20px rgba(0,0,0,.6);pointer-events:none;
}
#mm-root .mm-inspect-hd{display:flex;align-items:baseline;padding:var(--mm-sp-2) var(--mm-sp-3);border-bottom:1px solid rgba(53,224,232,.3);font-family:var(--mm-font-mono);font-size:var(--mm-fs-sm)}
#mm-root .mm-inspect-hd>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-inspect-hd b{color:var(--mm-inspect);font-weight:400}
#mm-root .mm-inspect-hd span{color:var(--mm-text-hi)}
#mm-root .mm-inspect-list{padding:var(--mm-sp-2) var(--mm-sp-3);display:flex;flex-direction:column}
#mm-root .mm-inspect-list>*+*{margin-top:1px}
#mm-root .mm-inspect-list div{display:flex;font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);color:var(--mm-text-dim)}
#mm-root .mm-inspect-list div>*+*{margin-left:var(--mm-sp-2)}
#mm-root .mm-inspect-list div b{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--mm-text);font-weight:400}
#mm-root .mm-inspect-hint{padding:var(--mm-sp-1) var(--mm-sp-3) var(--mm-sp-2);font-size:var(--mm-fs-xs);color:#3f434b}
`;

    /* ---------------------------------------------------------------------
       CSS2 — additions the port needs on top of the mockup.
       ------------------------------------------------------------------ */
    var CSS2 = String.raw`
/* Host: fixed over the whole window, above the game canvas (z-index 1), the
   video layer (2), the upper canvas (3), the FPS meter (9) and the error
   printer (99). The canvas element is not named here on purpose — it is
   GameCanvas on MV and gameCanvas on MZ, and $.caps.canvasId is the only place
   that difference is allowed to live; the MZ spelling silently finds nothing
   on MV, which reads as "the overlay never attached".

   The z-index is declared HERE, in the stylesheet, and must stay there: MV's
   Graphics._modifyExistingElements walks every element in the document during
   Graphics.initialize and zeroes any positive INLINE z-index it finds. A
   stylesheet declaration is out of its reach. See the !important re-assertion
   appended below for the case where something sets one anyway. */
#gigahack-host{position:fixed;left:0;top:0;right:0;bottom:0;width:100%;height:100%;z-index:2147483000;pointer-events:none}

/* click-through everywhere the overlay is transparent, so the game canvas
   keeps receiving input where we are not actually drawing a widget */
#mm-root{pointer-events:none}
#mm-root .mm-win,
#mm-root .mm-float,
#mm-root .mm-inspect,
#mm-root .mm-toast,
#mm-root .mm-layer>*{pointer-events:auto}

#mm-root .mm-layer{position:absolute;left:0;top:0;right:0;bottom:0;z-index:100;pointer-events:none}

/* Read-only mode (§6.3) — viewers stay live, mutating controls read as dead.

   Only controls that are ACTUALLY gated carry .mm-gated, so the dimming is an
   honest signal: searches, filters, the accent picker and the read-only toggle
   itself stay at full strength because they still work. Dimming everything
   made the read-only switch look disabled by itself, which read as a lie.

   Presentation only: the refusal is enforced in JS inside the widget factory.
   pointer-events:none here would stop the click before the gate ran, so the
   promised READ-ONLY toast would never appear. */
#mm-root.mm-ro .mm-gated{opacity:.45}

/* a milestone-not-yet-built placeholder panel */
#mm-root .mm-todo{
  flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;
  color:#3f434b;font-family:var(--mm-font-mono);font-size:var(--mm-fs-sm);
}
#mm-root .mm-todo>*+*{margin-top:var(--mm-sp-3)}
#mm-root .mm-todo b{color:var(--mm-text-dim);font-weight:400;letter-spacing:2px;text-transform:uppercase;font-size:var(--mm-fs-xs)}
#mm-root .mm-todo .mm-todo-ms{
  border:1px solid var(--mm-accent-line);color:var(--mm-accent);background:var(--mm-accent-soft);
  padding:2px 8px;letter-spacing:2px;font-size:var(--mm-fs-xs);
}
#mm-root .mm-pre{
  font-family:var(--mm-font-mono);font-size:var(--mm-fs-xs);white-space:pre;color:var(--mm-text);
  background:var(--mm-bg-sunken);border:1px solid var(--mm-line);padding:var(--mm-sp-3);
  overflow:auto;user-select:text;-webkit-user-select:text;
}
#mm-root .mm-selectable{user-select:text;-webkit-user-select:text}
/* A wrapping .mm-pre, for blocks that hold paths. .mm-pre itself keeps
   white-space:pre — the console's tape and reference depend on it — so a tail
   hidden behind a 6px horizontal scrollbar is fixed by opting in, not by
   changing the shared rule. */
#mm-root .mm-pre-wrap{white-space:pre-wrap;word-wrap:break-word;overflow-x:hidden}
/* Where the value must stay fully readable rather than ellipsised. break-all
   is the only value that reduces min-content width, which is what lets a flex
   item shrink at all; break-word does not. Never on prose. */
#mm-root .mm-breakall{white-space:normal;word-break:break-all}
`;

    /* ---------------------------------------------------------------------
       CSS3 — the two MV DOM hazards, asserted only where they exist.

       Both are things the ENGINE does to the whole document at boot, so
       neither is visible in any single rule above and neither shows up as an
       error. They are appended to CSS2 rather than written into it because on
       MZ they are noise, and a rule that is always on teaches the next reader
       that the hazard is universal when it is not.
       ------------------------------------------------------------------ */
    function mvDomGuards() {
        return $.safe(function () {
            var caps = $.caps || {};
            var out = '';

            if (caps.zIndexClobber) {
                /* MV: Graphics._modifyExistingElements() (called from
                   Graphics.initialize) walks document.getElementsByTagName('*')
                   and sets style.zIndex = 0 on every element whose INLINE
                   z-index is positive. We mount after boot and keep our stacking
                   in the stylesheet, so it cannot reach us — but a plugin that
                   re-initialises Graphics, or anything that writes an inline
                   z-index onto the host, would flatten the overlay behind the
                   canvas with no error at all. An !important author rule
                   outranks a normal inline declaration, so this survives it. */
                out += '\n#gigahack-host{z-index:2147483000 !important}';
            }

            if (caps.textSelectionBlocked) {
                /* MV: Graphics._disableTextSelection() sets user-select:none as
                   an INLINE style on document.body. It inherits into everything
                   we mount, so text the overlay means to be copyable is not, and
                   dragging across an input selects nothing. Opting back in per
                   surface is deliberate: the game canvas above still wants the
                   engine's behaviour, and so does the rest of the overlay —
                   selecting a label instead of dragging a window is worse. */
                out += '\n#mm-root input,#mm-root textarea,#mm-root .mm-cellinput,' +
                       '#mm-root .mm-pre,#mm-root .mm-selectable,#mm-root .mm-path' +
                       '{user-select:text !important;-webkit-user-select:text !important}';
            }

            return out;
        }, 'mv dom guards', '');
    }

    CSS2 += mvDomGuards();

    /* =====================================================================
       2. HELPERS
       ===================================================================== */
    function h(tag, attrs) {
        var n = document.createElement(tag), k, v;
        if (attrs) for (k in attrs) {
            v = attrs[k];
            if (v == null || v === false) continue;
            if (k === 'class') n.className = v;
            else if (k === 'text') n.textContent = v;
            else if (k === 'style') n.setAttribute('style', v);
            else if (k === 'tip') n.setAttribute('data-mm-tip', v);
            else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
            else n.setAttribute(k, v === true ? '' : v);
        }
        for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
        return n;
    }
    function add(parent, kid) {
        if (kid == null || kid === false) return;
        if (Array.isArray(kid)) { kid.forEach(function (k) { add(parent, k); }); return; }
        parent.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }

    /**
     * Same as add(), but a bare string becomes a real element.
     *
     * Table cells are flex containers, and a text node inside one is an
     * ANONYMOUS flex item: it has no box of its own, so overflow and
     * text-overflow cannot reach it and a long value is hard-clipped mid-word
     * with no ellipsis. Used for every table cell and header label.
     */
    function addCell(parent, kid) {
        if (kid == null || kid === false) return;
        if (Array.isArray(kid)) { kid.forEach(function (k) { addCell(parent, k); }); return; }
        if (kid.nodeType) { parent.appendChild(kid); return; }
        parent.appendChild(h('span', { class: 'mm-cell', text: String(kid) }));
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function pad(n, w) { return String(n).padStart(w || 2, '0'); }
    function now() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

    var SVG_NS = 'http://www.w3.org/2000/svg';
    function svg(d, box) {
        var s = document.createElementNS(SVG_NS, 'svg');
        s.setAttribute('viewBox', box || '0 0 16 16');
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor');
        s.setAttribute('stroke-width', '1.2');
        s.setAttribute('stroke-linecap', 'square');
        d.forEach(function (spec) {
            var el = document.createElementNS(SVG_NS, spec[0]);
            for (var k in spec[1]) el.setAttribute(k, spec[1][k]);
            s.appendChild(el);
        });
        return s;
    }

    /* Icons: stroke primitives at 14px currentColor, mockup set + two new
       ones (text, debug) built in the same vocabulary. */
    var ICON = {
        player: function () { return svg([['circle', { cx: 8, cy: 5, r: 2.6 }], ['path', { d: 'M3 14v-1.5h10V14' }]]); },
        party: function () { return svg([['circle', { cx: 5.5, cy: 6, r: 2.2 }], ['circle', { cx: 11, cy: 6, r: 1.7 }], ['path', { d: 'M2 13v-1h7v1M10 13v-1h4v1' }]]); },
        inventory: function () { return svg([['rect', { x: 2.5, y: 2.5, width: 4.5, height: 4.5 }], ['rect', { x: 9, y: 2.5, width: 4.5, height: 4.5 }], ['rect', { x: 2.5, y: 9, width: 4.5, height: 4.5 }], ['rect', { x: 9, y: 9, width: 4.5, height: 4.5 }]]); },
        variables: function () { return svg([['rect', { x: 2.5, y: 3.5, width: 11, height: 9 }], ['path', { d: 'M2.5 7h11M6.5 7v5.5' }]]); },
        teleport: function () { return svg([['path', { d: 'M8 2.5 13.5 8 8 13.5 2.5 8Z' }], ['circle', { cx: 8, cy: 8, r: 1.4 }]]); },
        events: function () { return svg([['path', { d: 'M8 2.5 14 13.5H2Z' }], ['path', { d: 'M8 6.5v3' }]]); },
        battle: function () { return svg([['path', { d: 'M3 3l10 10M13 3L3 13' }], ['circle', { cx: 8, cy: 8, r: 1.2 }]]); },
        forge: function () { return svg([['rect', { x: 2.5, y: 8.5, width: 11, height: 4 }], ['path', { d: 'M5 8.5V5h6v3.5M8 2.5v2' }]]); },
        settings: function () { return svg([['circle', { cx: 8, cy: 8, r: 3 }], ['path', { d: 'M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2' }]]); },
        text: function () { return svg([['rect', { x: 2.5, y: 3, width: 11, height: 8 }], ['path', { d: 'M5 11v2.5L7.5 11' }], ['path', { d: 'M5 6h6M5 8.2h4' }]]); },
        debug: function () { return svg([['rect', { x: 2.5, y: 3.5, width: 11, height: 9 }], ['path', { d: 'M5 6.5 7 8l-2 1.5M8.5 10h3' }]]); },
        pin: function () { return svg([['path', { d: 'M8 9.5V14' }], ['rect', { x: 4.5, y: 2.5, width: 7, height: 7 }]]); },
        opacity: function () { return svg([['circle', { cx: 8, cy: 8, r: 5.5 }], ['path', { d: 'M8 2.5v11' }], ['path', { d: 'M8 13.5A5.5 5.5 0 0 0 8 2.5', fill: 'currentColor', stroke: 'none' }]]); },
        close: function () { return svg([['path', { d: 'M4 4l8 8M12 4l-8 8' }]]); },
        search: function () { return svg([['circle', { cx: 7, cy: 7, r: 4.2 }], ['path', { d: 'M10.3 10.3 14 14' }]]); },
        dot: function () { return svg([['circle', { cx: 8, cy: 8, r: 3, fill: 'currentColor', stroke: 'none' }]]); }
    };

    /* =====================================================================
       2b. ACCENT DERIVATION
       The mockup derives five accent variants with color-mix(). That function
       needs Chromium 111+, which is far above anything either engine ships:
       MV 1.6 is NW.js 0.29 (Chromium 66) and even a recent MZ is well short of
       111. An unsupported value in a custom property does not degrade — it
       invalidates the property, and with it every rule that reads it, which is
       the whole accent. So the derivation is done here instead, in JS, writing
       exactly the same token names. Every caller must go through this rather
       than setting --mm-accent directly.
       ===================================================================== */
    function hexToRgb(hex) {
        var m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(hex).trim());
        if (!m) return null;
        var s = m[1];
        if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
        var n = parseInt(s, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function applyAccent(root, hex) {
        var rgb = hexToRgb(hex);
        if (!rgb) { rgb = [108, 122, 224]; hex = '#6c7ae0'; }
        var t = rgb.join(',');
        root.style.setProperty('--mm-accent', hex);
        root.style.setProperty('--mm-accent-soft', 'rgba(' + t + ',.18)');
        root.style.setProperty('--mm-accent-line', 'rgba(' + t + ',.45)');
        root.style.setProperty('--mm-accent-soft2', 'rgba(' + t + ',.32)');
        root.style.setProperty('--mm-accent-flash', 'rgba(' + t + ',.45)');
        // accent 70% + white 30%
        var hi = rgb.map(function (c) { return Math.round(c * 0.7 + 255 * 0.3); });
        root.style.setProperty('--mm-accent-hi',
            '#' + hi.map(function (c) { return pad(c.toString(16)); }).join(''));
        return hex;
    }

    /* =====================================================================
       2c. ICONSET

       A project may ship with hasEncryptedImages, in which case the file on
       disk is img/system/IconSet.png_ and no CSS url() can reach it. The sheet
       is therefore pulled through ImageManager — which is what decrypts it —
       converted once to a data URL, and injected as a single stylesheet rule;
       per element we only set background-position, so the ~500KB URL exists
       exactly once in the DOM however many icons are on screen.

       WHAT IS CACHED HERE IS THE RULE TEXT, NEVER THE BITMAP. Some games clear
       ImageManager on every map transfer, and clearing it destroys the base
       texture behind any Bitmap still being held: the object survives, the
       pixels do not, and reading .canvas off it later yields a blank or throws.
       So the Bitmap is re-fetched from ImageManager on every attempt and
       dropped again as soon as the pixels have been turned into a string.

       The <style> element lives in the overlay host, which the shell can tear
       down and rebuild. A remount would leave the 'ready' flag set with no rule
       in the document, so readiness is a question about the element, not about
       the flag.
       ===================================================================== */
    var iconState = 'idle';   // idle | ready | unavailable
    var iconCss = null;       // the finished rule — a plain string, not a Bitmap
    var iconStyle = null;     // the <style> element carrying it

    function mountIconSheet() {
        var el = document.createElement('style');
        el.id = 'gigahack-iconset';
        el.textContent = iconCss;
        (HOST && HOST.root && HOST.root.parentNode ? HOST.root.parentNode : document.head).appendChild(el);
        iconStyle = el;
        return true;
    }

    function ensureIconSheet() {
        if (iconState === 'unavailable') return false;
        if (iconState === 'ready') {
            if (iconStyle && iconStyle.parentNode) return true;
            // Host was rebuilt under us; the rule text outlived it.
            return $.safe(mountIconSheet, 'IconSet remount', false);
        }
        var ok = $.safe(function () {
            if (typeof ImageManager === 'undefined' || !ImageManager.loadSystem) return false;
            // Re-fetched, never cached: see the note above about ImageManager
            // being cleared on map transfer.
            var bmp = ImageManager.loadSystem('IconSet');
            if (!bmp || !bmp.isReady || !bmp.isReady()) return null;   // still loading — try again later
            if (!bmp.canvas) return false;
            var url = bmp.canvas.toDataURL('image/png');
            if (!url || url.length < 64) return false;
            // MV has no ImageManager.iconWidth — it is Window_Base._iconWidth,
            // and it is 32. $.eng answers for both engines, and for the plugins
            // that change it on either.
            var iw = $.eng.iconWidth(), ih = $.eng.iconHeight();
            // 16 icons per row; the sheet is scaled so one icon renders at 16px.
            // The height is derived rather than left to 'auto' so a sheet whose
            // icons are not square still lands on the 16px grid.
            var sheetH = (bmp.height && ih) ? (Math.round(bmp.height * 16 / ih) + 'px') : 'auto';
            iconCss = '#mm-root .mm-icon{width:16px;height:16px;flex:0 0 auto;display:block;' +
                'background-image:url(' + url + ');background-size:' + (16 * 16) + 'px ' + sheetH + ';' +
                'image-rendering:auto}';
            mountIconSheet();
            $.log('ok', 'IconSet decoded (' + iw + '×' + ih + ' source icons)');
            return true;
        }, 'IconSet decode', false);
        if (ok === null) return false;          // not ready yet, stay 'idle'
        iconState = ok ? 'ready' : 'unavailable';
        if (!ok) $.log('warn', 'IconSet unavailable — item icons will be omitted');
        return ok;
    }

    /** A 16x16 icon element, or a neutral placeholder when the sheet is out. */
    function iconEl(index) {
        if (index == null || index < 0 || !ensureIconSheet()) {
            return h('i', { class: 'mm-icocell', style: 'width:16px;height:16px;box-shadow:none;border-color:#22242a' });
        }
        var col = index % 16, row = Math.floor(index / 16);
        return h('i', { class: 'mm-icon', style: 'background-position:' + (-col * 16) + 'px ' + (-row * 16) + 'px' });
    }

    /* =====================================================================
       3. HOST SERVICES
       ===================================================================== */
    var HOST = null; /* { root, layer, toasts, logBody, tickHooks[], ... } */

    function openPopup(anchor, node, opts) {
        opts = opts || {};
        closePopup();
        var pop = h('div', { class: 'mm-pop' });
        add(pop, node);
        HOST.layer.appendChild(pop);
        var a = anchor.getBoundingClientRect(), r = HOST.root.getBoundingClientRect();
        var w = pop.offsetWidth, hh = pop.offsetHeight;
        var left = clamp(a.left - r.left + (opts.align === 'left' ? 0 : a.width - w), 4, r.width - w - 4);
        var top = a.bottom - r.top + 2;
        if (top + hh > r.height - 4) top = a.top - r.top - hh - 2;
        pop.style.left = left + 'px'; pop.style.top = top + 'px';
        var token = { el: pop, anchor: anchor, onClose: opts.onClose };
        HOST.popup = token;
        setTimeout(function () {
            // The popup may already have been closed inside this same task; if
            // so, installing the guard would leak a document listener that
            // nothing can remove and that would later close unrelated popups.
            if (HOST.popup !== token) return;
            HOST.popupGuard = function (e) { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopup(); };
            document.addEventListener('pointerdown', HOST.popupGuard, true);
        }, 0);
        return pop;
    }
    function closePopup() {
        if (!HOST || !HOST.popup) return false;
        var p = HOST.popup; HOST.popup = null;
        if (HOST.popupGuard) { document.removeEventListener('pointerdown', HOST.popupGuard, true); HOST.popupGuard = null; }
        p.el.remove();
        if (p.onClose) p.onClose();
        return true;
    }

    function initTooltips(root, layer) {
        var tip = null, timer = null;
        function hide() { clearTimeout(timer); if (tip) { tip.remove(); tip = null; } }
        root.addEventListener('pointerover', function (e) {
            var t = e.target.closest ? e.target.closest('[data-mm-tip]') : null;
            if (!t) return;
            hide();
            timer = setTimeout(function () {
                var txt = t.getAttribute('data-mm-tip'), parts = txt.split('|');
                tip = h('div', { class: 'mm-tip' }, parts.length > 1 ? h('b', { text: parts[0] }) : null, parts.length > 1 ? parts[1] : parts[0]);
                layer.appendChild(tip);
                var b = t.getBoundingClientRect(), r = root.getBoundingClientRect();
                tip.style.left = clamp(b.left - r.left, 4, r.width - tip.offsetWidth - 4) + 'px';
                var top = b.bottom - r.top + 4;
                if (top + tip.offsetHeight > r.height - 4) top = b.top - r.top - tip.offsetHeight - 4;
                tip.style.top = top + 'px';
            }, 400);
        });
        root.addEventListener('pointerout', function (e) {
            if (e.target.closest && e.target.closest('[data-mm-tip]')) hide();
        });
        root.addEventListener('pointerdown', hide, true);
    }

    /**
     * Drag helper. Same as the mockup, plus an onEnd callback so the shell can
     * persist the window position without polling.
     */
    function makeDraggable(handle, target, root, onEnd) {
        handle.addEventListener('pointerdown', function (e) {
            if (e.target.closest('.mm-icobtn')) return;
            e.preventDefault();
            var r = target.getBoundingClientRect(), rr = root.getBoundingClientRect();
            var ox = e.clientX - r.left, oy = e.clientY - r.top;
            handle.classList.add('mm-dragging');
            handle.setPointerCapture(e.pointerId);
            function move(ev) {
                target.style.left = clamp(ev.clientX - rr.left - ox, -r.width + 40, rr.width - 40) + 'px';
                target.style.top = clamp(ev.clientY - rr.top - oy, 0, rr.height - 20) + 'px';
                target.style.right = 'auto'; target.style.bottom = 'auto';
            }
            function up() {
                handle.classList.remove('mm-dragging');
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
                if (onEnd) $.safe(function () { onEnd(parseFloat(target.style.left) || 0, parseFloat(target.style.top) || 0); }, 'drag persist');
            }
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
        });
    }

    /* =====================================================================
       4. WIDGET FACTORIES
       Read-only gating lives here (§6.3) so no tab reimplements it.
       ===================================================================== */

    /**
     * Read-only gate.
     *
     * The check happens BEFORE the widget mutates its own value, so a blocked
     * control does not end up displaying a number that was never applied.
     * Controls that only change the overlay itself (accent, scale, the
     * read-only toggle) opt out with `_ungated`.
     */
    function ungated(o) { o = o || {}; o._ungated = true; return o; }

    function gate(opts, label) {
        var free = !!(opts && opts._ungated);
        var fn = opts && opts.onChange;
        return {
            fn: fn,
            free: free,
            // Class marking a control the read-only gate will actually refuse.
            // Only these are dimmed, so the dimming never misrepresents a
            // control that still works.
            cls: (!free && fn && !(opts && opts._noMark)) ? ' mm-gated' : '',
            allows: function () { return free || !$.isReadOnly() || $.allowWrite(label); }
        };
    }

    function mmCheckbox(opts) {
        opts = opts || {};
        var on = !!opts.value;
        var g = gate(opts, opts.label);
        var box = h('div', { class: 'mm-check' + g.cls + (on ? ' mm-on' : '') + (opts.disabled ? ' mm-dis' : ''), role: 'checkbox' });
        function set(v, silent) {
            if (!silent && g.fn && !g.allows()) return;   // refuse before painting
            on = !!v; box.classList.toggle('mm-on', on);
            if (!silent && g.fn) g.fn(on);
        }
        // Same reason as mmButton's: pointer-events:none stops a pointer and
        // nothing else, and the row wrapper forwards clicks here by hand.
        box.addEventListener('click', function (e) {
            e.stopPropagation();
            if (box.classList.contains('mm-dis')) return;
            set(!on);
        });
        box.mm = {
            get: function () { return on; },
            set: set,
            toggle: function () { if (!box.classList.contains('mm-dis')) set(!on); },
            disable: function (d) { box.classList.toggle('mm-dis', d); }
        };
        return box;
    }

    function mmSlider(opts) {
        opts = opts || {};
        var min = opts.min == null ? 0 : opts.min, max = opts.max == null ? 100 : opts.max;
        var step = opts.step || 1, dec = String(step).indexOf('.') > -1 ? String(step).split('.')[1].length : 0;
        var val = clamp(opts.value == null ? min : opts.value, min, max);
        var g = gate(opts, opts.label);
        var fill = h('i', { class: 'mm-slider-fill' }), knob = h('i', { class: 'mm-slider-knob' });
        var track = h('div', { class: 'mm-slider-track' }, fill, knob);
        var box = h('input', { class: 'mm-numbox', value: val.toFixed(dec) });
        var wrap = h('div', { class: 'mm-slider' + g.cls + (opts.disabled ? ' mm-dis' : ''), style: opts.width ? 'width:' + opts.width : null }, track, box);
        function paint() {
            var p = (val - min) / (max - min) * 100;
            fill.style.width = p + '%'; knob.style.left = p + '%';
            if (document.activeElement !== box) box.value = val.toFixed(dec) + (opts.unit || '');
        }
        function set(v, silent) {
            v = clamp(Math.round(v / step) * step, min, max);
            if (Math.abs(v - val) < 1e-9) { paint(); return; }
            if (!silent && g.fn && !g.allows()) { paint(); return; }
            val = v; paint();
            if (!silent && g.fn) g.fn(val);
        }
        // The track geometry is captured once per drag, not re-read per move.
        // The UI-scale slider changes --mm-scale, which transforms the window
        // the slider lives in: re-measuring mid-drag makes the track move under
        // the pointer and the value snaps to the extremes instead of tracking
        // the mouse.
        var dragRect = null;
        function fromEvent(e) {
            var r = dragRect || track.getBoundingClientRect();
            set(min + (max - min) * clamp((e.clientX - r.left) / r.width, 0, 1));
        }
        track.addEventListener('pointerdown', function (e) {
            e.preventDefault(); track.setPointerCapture(e.pointerId);
            dragRect = track.getBoundingClientRect();
            fromEvent(e);
            function mv(ev) { fromEvent(ev); }
            function up() {
                dragRect = null;
                track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up);
                // Fired ONCE per gesture. onChange runs per pointermove, which
                // is right for anything that only repaints and ruinous for
                // anything that writes a file — see A.setVolume.
                if (opts.onCommit && g.allows()) $.safe(function () { opts.onCommit(val); }, 'slider commit');
            }
            track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
        });
        box.addEventListener('change', function () {
            set(parseFloat(box.value) || 0); paint();
            if (opts.onCommit && g.allows()) $.safe(function () { opts.onCommit(val); }, 'slider commit');
        });
        box.addEventListener('keydown', function (e) { if (e.key === 'Enter') box.blur(); });
        box.addEventListener('blur', paint);
        paint();
        wrap.mm = { get: function () { return val; }, set: set, disable: function (d) { wrap.classList.toggle('mm-dis', d); } };
        return wrap;
    }

    function mmNumber(opts) {
        opts = opts || {};
        var min = opts.min == null ? -Infinity : opts.min, max = opts.max == null ? Infinity : opts.max;
        var step = opts.step || 1, val = clamp(opts.value == null ? 0 : opts.value, min, max);
        var g = gate(opts, opts.label);
        var input = h('input', { class: 'mm-mono', value: val });
        var dn = h('button', { class: 'mm-step', text: '−', tabindex: -1 });
        var up = h('button', { class: 'mm-step', text: '+', tabindex: -1 });
        var wrap = h('div', { class: 'mm-num' + g.cls + (opts.wide ? ' mm-num-wide' : '') + (opts.disabled ? ' mm-dis' : '') }, dn, input, up);
        function set(v, silent) {
            v = clamp(v, min, max);
            if (v === val) { input.value = val; return; }
            if (!silent && g.fn && !g.allows()) { input.value = val; return; }
            val = v; input.value = val;
            if (!silent && g.fn) g.fn(val);
        }
        dn.onclick = function () { set(val - step); };
        up.onclick = function () { set(val + step); };
        input.addEventListener('change', function () { set(parseFloat(input.value) || 0); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowUp') { e.preventDefault(); set(val + step); }
            if (e.key === 'ArrowDown') { e.preventDefault(); set(val - step); }
            if (e.key === 'Enter') input.blur();
        });
        input.addEventListener('focus', function () { wrap.classList.add('mm-focus'); });
        input.addEventListener('blur', function () { wrap.classList.remove('mm-focus'); input.value = val; });
        wrap.mm = { get: function () { return val; }, set: set, disable: function (d) { wrap.classList.toggle('mm-dis', d); } };
        return wrap;
    }

    function mmText(opts) {
        opts = opts || {};
        var input = h('input', {
            class: 'mm-input' + (opts.mono ? ' mm-mono' : ''),
            value: opts.value || '', placeholder: opts.placeholder || '',
            style: opts.width ? 'width:' + opts.width : 'flex:1 1 auto'
        });
        input.addEventListener('input', function () { if (opts.onInput) opts.onInput(input.value); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && opts.onEnter) opts.onEnter(input.value); });
        input.mmEscape = function () {
            input.value = opts.value || '';
            if (opts.onInput) opts.onInput(input.value);
        };
        input.mm = { get: function () { return input.value; }, set: function (v) { input.value = v; } };
        return input;
    }

    /**
     * Multi-line text. The one field in RPG Maker that genuinely holds
     * newlines is an actor's profile — it is drawn as two lines in the status
     * window — so a single-line input silently truncates the second one.
     * Enter inserts a newline here; commit is on blur, which is why onCommit
     * exists alongside onInput.
     */
    function mmTextarea(opts) {
        opts = opts || {};
        var g = gate(opts, opts.label);
        var el = h('textarea', {
            class: 'mm-textarea' + (opts.mono ? ' mm-mono' : '') + g.cls,
            placeholder: opts.placeholder || '',
            rows: String(opts.rows || 2),
            style: opts.width ? 'width:' + opts.width : null
        });
        el.value = opts.value == null ? '' : String(opts.value);
        var last = el.value;
        el.addEventListener('input', function () { if (opts.onInput) opts.onInput(el.value); });
        el.addEventListener('blur', function () {
            if (el.value === last) return;
            if (g.fn && !g.allows()) { el.value = last; return; }   // refuse before painting
            last = el.value;
            if (opts.onCommit) opts.onCommit(el.value);
            if (g.fn) g.fn(el.value);
        });
        el.mmEscape = function () { el.value = last; el.blur(); };
        el.mm = { get: function () { return el.value; }, set: function (v) { el.value = v; last = v; } };
        return el;
    }

    function mmSearch(opts) {
        opts = opts || {};
        var input = h('input', { placeholder: opts.placeholder || 'search…' });
        // A remembered query has to be VISIBLE in the box. A list filtered by
        // a term the field does not show is indistinguishable from a list that
        // has lost most of its rows.
        if (opts.value) input.value = String(opts.value);
        var wrap = h('div', { class: 'mm-search', style: opts.width ? 'flex:0 0 ' + opts.width : null }, ICON.search(), input);
        input.addEventListener('input', function () { if (opts.onInput) opts.onInput(input.value.toLowerCase()); });
        // Escape inside a search field clears the filter and leaves the field;
        // the shell's hotkey handler calls this before blurring.
        input.mmEscape = function () { input.value = ''; if (opts.onInput) opts.onInput(''); };
        wrap.mm = {
            get: function () { return input.value; },
            set: function (v) { input.value = v == null ? '' : String(v); },
            clear: function () { input.mmEscape(); },
            focus: function () { input.focus(); }
        };
        return wrap;
    }

    function mmDropdown(opts) {
        opts = opts || {};
        var multi = !!opts.multi;
        var value = multi ? (opts.value || []).slice() : (opts.value != null ? opts.value : opts.options[0]);
        var g = gate(opts, opts.label);
        var label = h('span', {});
        var btn = h('button', { class: 'mm-dd-btn' }, label, h('i', { class: 'mm-dd-arrow' }));
        var panel = h('div', { class: 'mm-dd-panel' });
        var wrap = h('div', { class: 'mm-dd' + g.cls + (opts.disabled ? ' mm-dd-dis' : ''), style: opts.width ? 'width:' + opts.width : null }, btn, panel);
        function text() {
            if (!multi) return String(value);
            if (!value.length) return opts.emptyLabel || 'none';
            if (value.length === opts.options.length) return opts.allLabel || 'all';
            return value.length + ' selected';
        }
        function paint() {
            label.textContent = text();
            Array.prototype.forEach.call(panel.children, function (o) {
                var v = o.getAttribute('data-mm-v');
                var on = multi ? value.indexOf(v) > -1 : v === String(value);
                o.classList.toggle('mm-on', on);
                o.firstChild.textContent = on ? (multi ? '✓' : '▪') : '';
            });
        }
        opts.options.forEach(function (o) {
            var opt = h('div', { class: 'mm-opt', 'data-mm-v': o }, h('i', { class: 'mm-opt-tick' }), h('span', { text: o }));
            opt.addEventListener('click', function () {
                if (g.fn && !g.allows()) { wrap.classList.remove('mm-open'); return; }
                if (multi) {
                    var i = value.indexOf(o);
                    if (i > -1) value.splice(i, 1); else value.push(o);
                } else { value = o; wrap.classList.remove('mm-open'); }
                paint();
                if (g.fn) g.fn(multi ? value.slice() : value);
            });
            panel.appendChild(opt);
        });
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = !wrap.classList.contains('mm-open');
            var others = HOST.root.querySelectorAll('.mm-dd.mm-open');
            Array.prototype.forEach.call(others, function (d) { d.classList.remove('mm-open'); });
            wrap.classList.toggle('mm-open', open);
            if (open) {
                var b = btn.getBoundingClientRect(), r = HOST.root.getBoundingClientRect();
                wrap.classList.toggle('mm-dd-up', b.bottom + 152 > r.bottom);
            }
        });
        function guard(e) {
            if (!HOST.root.contains(wrap)) { document.removeEventListener('pointerdown', guard, true); return; }
            if (!wrap.contains(e.target)) wrap.classList.remove('mm-open');
        }
        document.addEventListener('pointerdown', guard, true);
        paint();
        wrap.mm = { get: function () { return multi ? value.slice() : value; }, set: function (v) { value = v; paint(); }, disable: function (d) { wrap.classList.toggle('mm-dd-dis', d); } };
        return wrap;
    }

    /* keybind — the mockup's [-] box. `key` is a KeyboardEvent.code so the
       bind is layout-independent and never collides with Input.keyMapper. */
    var KB_MODES = ['Always on', 'On hotkey', 'Toggle', 'Off hotkey'];
    function prettyCode(code) {
        if (!code) return null;
        return String(code)
            .replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'NUM ')
            .replace(/^Arrow/, '').toUpperCase();
    }
    function mmKeybind(opts) {
        opts = opts || {};
        var key = opts.key || null, mode = opts.mode || 'On hotkey';
        var el = h('button', { class: 'mm-kb' });
        function paint() {
            el.textContent = key ? prettyCode(key) : '[-]';
            el.classList.toggle('mm-set', !!key);
            el.setAttribute('data-mm-tip', 'Keybind|' + (key ? prettyCode(key) + ' · ' + mode : 'unbound'));
        }
        function popup() {
            var listening = false;
            var kbRow = h('button', { class: 'mm-pop-opt', style: 'justify-content:space-between' },
                h('span', { text: 'Key' }), h('b', { class: 'mm-mono mm-hi', text: prettyCode(key) || '[-]' }));
            var modeRows = (opts.modes === false ? [] : KB_MODES).map(function (m) {
                var row = h('button', { class: 'mm-pop-opt' + (m === mode ? ' mm-on' : '') },
                    h('i', { class: 'mm-radio' }), h('span', { text: m }));
                row.addEventListener('click', function () {
                    mode = m;
                    Array.prototype.forEach.call(row.parentNode.children, function (r) { if (r.classList.contains('mm-pop-opt')) r.classList.remove('mm-on'); });
                    row.classList.add('mm-on'); paint();
                    if (opts.onChange) opts.onChange({ key: key, mode: mode });
                });
                return row;
            });
            // .mm-stack-tight, not an inline gap: gap needs Chromium 84 and the
            // floor is 66, so the 1px step is a margin rule in the stylesheet.
            var body = h('div', { class: 'mm-stack-tight', style: 'width:126px' },
                h('div', { class: 'mm-pop-hd', text: 'Keybind' }), kbRow,
                modeRows.length ? h('div', { class: 'mm-sep', style: 'margin:3px 0' }) : null,
                modeRows.length ? h('div', { class: 'mm-pop-hd', text: 'Mode' }) : null, modeRows,
                h('div', { class: 'mm-sep', style: 'margin:3px 0' }),
                h('button', {
                    class: 'mm-pop-opt', style: 'color:#c2707c',
                    onclick: function () { key = null; paint(); closePopup(); if (opts.onChange) opts.onChange({ key: null, mode: mode }); }
                }, h('span', { text: 'Clear bind' })));
            function onKey(e) {
                if (!listening) return;
                e.preventDefault(); e.stopPropagation();
                if (e.code === 'Escape') { listening = false; kbRow.classList.remove('mm-listen'); kbRow.lastChild.textContent = prettyCode(key) || '[-]'; return; }
                key = e.code;
                listening = false; kbRow.classList.remove('mm-listen'); kbRow.lastChild.textContent = prettyCode(key);
                paint(); if (opts.onChange) opts.onChange({ key: key, mode: mode });
            }
            kbRow.addEventListener('click', function () {
                listening = true; kbRow.classList.add('mm-listen'); kbRow.lastChild.textContent = 'press…';
            });
            window.addEventListener('keydown', onKey, true);
            openPopup(el, body, { onClose: function () { window.removeEventListener('keydown', onKey, true); el.classList.remove('mm-listen'); } });
            el.classList.add('mm-listen');
        }
        el.addEventListener('click', function (e) { e.stopPropagation(); popup(); });
        paint();
        el.mm = { get: function () { return { key: key, mode: mode }; }, set: function (v) { key = v.key; mode = v.mode || mode; paint(); } };
        return el;
    }

    /* colour picker */
    function hsv2rgb(hh, s, v) {
        var f = function (n) {
            var k = (n + hh / 60) % 6;
            return Math.round(255 * (v - v * s * Math.max(Math.min(k, 4 - k, 1), 0)));
        };
        return [f(5), f(3), f(1)];
    }
    function rgb2hex(r) { return '#' + r.map(function (c) { return pad(c.toString(16)); }).join(''); }
    function hex2hsv(hex) {
        var m = /^#?([\da-f]{6})$/i.exec(String(hex).trim());
        if (!m) return null;
        var n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, hh = 0;
        if (d) hh = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
        return [(hh + 360) % 360, mx ? d / mx : 0, mx];
    }
    function mmColor(opts) {
        opts = opts || {};
        var hsv = hex2hsv(opts.value || '#6c7ae0') || [240, .5, .9];
        var sw = h('button', { class: 'mm-sw', tip: 'Colour|Saturation, hue, hex' });
        function hex() { return rgb2hex(hsv2rgb(hsv[0], hsv[1], hsv[2])); }
        function paint() { sw.style.background = hex(); }
        sw.addEventListener('click', function (e) {
            e.stopPropagation();
            var sv = h('div', { class: 'mm-sv' }), dot = h('i', { class: 'mm-dot' });
            var hue = h('div', { class: 'mm-hue' }), hdot = h('i', { class: 'mm-hue-dot' });
            var hx = mmText({ value: hex(), mono: true, width: '100%' });
            sv.appendChild(dot); hue.appendChild(hdot);
            function repaint() {
                // Comma form: hsl() with space-separated arguments is CSS Color 4
                // and only just made the floor (Chromium 65 of 66). The commas
                // are CSS3 and work on every renderer this runs on.
                sv.style.background = 'linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(' +
                    Math.round(hsv[0]) + ',100%,50%))';
                dot.style.left = hsv[1] * 100 + '%'; dot.style.top = (1 - hsv[2]) * 100 + '%';
                hdot.style.left = hsv[0] / 360 * 100 + '%';
                hx.value = hex(); paint();
                if (opts.onChange) opts.onChange(hex());
            }
            function grab(node, fn) {
                node.addEventListener('pointerdown', function (ev) {
                    ev.preventDefault(); node.setPointerCapture(ev.pointerId);
                    var r = node.getBoundingClientRect();
                    function mv(e2) { fn(clamp((e2.clientX - r.left) / r.width, 0, 1), clamp((e2.clientY - r.top) / r.height, 0, 1)); repaint(); }
                    mv(ev);
                    function up() { node.removeEventListener('pointermove', mv); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); }
                    node.addEventListener('pointermove', mv); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
                });
            }
            grab(sv, function (x, y) { hsv[1] = x; hsv[2] = 1 - y; });
            grab(hue, function (x) { hsv[0] = x * 360; });
            hx.addEventListener('change', function () { var v = hex2hsv(hx.value); if (v) { hsv = v; repaint(); } });
            // .mm-stack is exactly this: a column with a 4px step, spaced with
            // margins because flex gap is above the floor.
            var body = h('div', { class: 'mm-stack', style: 'width:118px' },
                h('div', { class: 'mm-pop-hd', text: opts.label || 'Colour' }), sv, hue,
                h('div', { class: 'mm-inline' }, hx));
            openPopup(sw, body);
            repaint();
        });
        paint();
        sw.mm = { get: hex, set: function (v) { var x = hex2hsv(v); if (x) { hsv = x; paint(); } } };
        return sw;
    }

    function mmButton(opts) {
        opts = opts || {};
        var cls = 'mm-btn';
        if (opts.variant === 'danger') cls += ' mm-btn-danger';
        if (opts.variant === 'prime') cls += ' mm-btn-prime';
        if (opts.wide) cls += ' mm-btn-wide';
        if (opts.tall) cls += ' mm-btn-tall';
        if (opts.mini) cls += ' mm-btn-mini';
        if (opts.disabled) cls += ' mm-dis';
        // Only buttons the gate will actually refuse get marked.
        if (!opts._ungated && (opts.variant === 'danger' || opts.mutates)) cls += ' mm-gated';
        var btn = h('button', { class: cls, text: opts.label, tip: opts.tip || null });
        var armed = false, timer = null;
        /* .mm-dis carries pointer-events:none, so a POINTER cannot reach a
           disabled button — but el.click() and a dispatched event both ignore
           that, and mm.disable() can add the class long after the handler was
           attached. Disabled has to mean one thing on every path, or a control
           the panel has greyed with a reason still runs when something asks it
           to programmatically. */
        function blocked() { return btn.classList.contains('mm-dis'); }
        // Dangerous buttons obey the "confirm dangerous actions" setting; a
        // button explicitly marked confirm:true always confirms.
        function needsConfirm() {
            if (opts.confirm) return true;
            return opts.variant === 'danger' && $.store.cfgGet('behaviour.confirmDangerous', true);
        }
        function disarm() { armed = false; btn.classList.remove('mm-armed'); btn.textContent = opts.label; clearTimeout(timer); }
        btn.addEventListener('click', function () {
            if (blocked()) { disarm(); return; }
            if (!opts._ungated && $.isReadOnly() && (opts.variant === 'danger' || opts.mutates)) {
                disarm();
                $.allowWrite(opts.label);
                return;
            }
            if (needsConfirm() && !armed) {
                armed = true; btn.classList.add('mm-armed');
                btn.textContent = opts.confirmLabel || 'confirm?';
                timer = setTimeout(disarm, 2600);
                return;
            }
            disarm();
            if (opts.onClick) $.safe(function () { opts.onClick(btn); }, 'button "' + opts.label + '"');
        });
        btn.mm = { disable: function (d) { btn.classList.toggle('mm-dis', d); }, disarm: disarm };
        return btn;
    }

    function mmChip(opts) {
        var on = !!opts.value;
        var el = h('button', { class: 'mm-chip' + (on ? ' mm-on' : ''), text: opts.label, tip: opts.tip || null });
        el.addEventListener('click', function () { on = !on; el.classList.toggle('mm-on', on); if (opts.onChange) opts.onChange(on, opts.label); });
        el.mm = { get: function () { return on; }, set: function (v) { on = !!v; el.classList.toggle('mm-on', on); } };
        return el;
    }

    function mmRow(label, controls, opts) {
        opts = opts || {};
        var lab = h('div', { class: 'mm-lab' }, label, opts.sub ? h('span', { class: 'mm-sub', text: '  ' + opts.sub }) : null);
        // opts.edgeClass is how a row says its value is a STRING of unknown
        // length rather than a control. The classes have to land on the EDGE —
        // that is the flex:0 0 auto box — so putting them on the child does
        // nothing at all, which is a silent way to keep squeezing the label.
        var edge = h('div', { class: 'mm-edge' + (opts.edgeClass ? ' ' + opts.edgeClass : '') });
        add(edge, controls);
        if (opts.keybind) edge.appendChild(mmKeybind(opts.keybind === true ? {} : opts.keybind));
        if (opts.color) edge.appendChild(mmColor(typeof opts.color === 'string' ? { value: opts.color, label: label } : opts.color));
        var row = h('div', { class: 'mm-row', tip: opts.tip || null, style: opts.indent ? 'padding-left:12px' : null }, lab, edge);
        row.mm = { label: lab, edge: edge };
        return row;
    }

    function mmToggleRow(label, opts) {
        opts = opts || {};
        var gated = !opts._ungated && !!opts.onChange;
        var cb = mmCheckbox({
            value: opts.value, onChange: opts.onChange, label: label,
            disabled: opts.disabled, _ungated: opts._ungated, _noMark: true
        });
        var lab = h('div', { class: 'mm-lab' }, label, opts.sub ? h('span', { class: 'mm-sub', text: '  ' + opts.sub }) : null);
        var edge = h('div', { class: 'mm-edge' + (opts.edgeClass ? ' ' + opts.edgeClass : '') });
        if (opts.extra) add(edge, opts.extra);
        if (opts.keybind) edge.appendChild(mmKeybind(opts.keybind === true ? {} : opts.keybind));
        if (opts.color) edge.appendChild(mmColor({ value: opts.color, label: label }));
        var row = h('label', { class: 'mm-cbrow' + (gated ? ' mm-gated' : ''), tip: opts.tip || null }, cb, lab, edge);
        row.addEventListener('click', function (e) {
            if (e.target === cb || cb.contains(e.target) || edge.contains(e.target)) return;
            cb.mm.toggle();
        });
        row.mm = cb.mm;
        return row;
    }

    function mmGroup(title, children, opts) {
        opts = opts || {};
        var caret = h('i', { class: 'mm-caret' });
        var hd = h('button', { class: 'mm-group-hd' }, caret, h('span', { text: title }), opts.tag ? h('span', { class: 'mm-group-tag', text: opts.tag }) : null);
        var bd = h('div', { class: 'mm-group-bd' });
        add(bd, children);
        var g = h('div', { class: 'mm-group' + (opts.collapsed ? ' mm-collapsed' : '') + (opts.grow ? ' mm-grow' : '') }, hd, bd);
        hd.addEventListener('click', function () { g.classList.toggle('mm-collapsed'); });
        g.mm = {
            body: bd, head: hd,
            toggle: function () { g.classList.toggle('mm-collapsed'); },
            tag: function (t) { var el = hd.querySelector('.mm-group-tag'); if (el) el.textContent = t; }
        };
        return g;
    }

    /**
     * Table. Two modes:
     *   default — render every row (fine below a couple of hundred rows)
     *   virtual:true — windowed rendering with a spacer above/below. Required
     *     for any list whose length is the project's, not ours: variables,
     *     switches and the item database run to four figures on a large game
     *     and are read straight out of $data*, so the row count is discovered,
     *     never assumed. Above a couple of hundred rows, use it (§2).
     * `.mm.paint(rows)` re-renders; `.mm.refresh()` repaints the current rows.
     */
    function mmTable(opts) {
        var ROW_H = opts.rowH || 17;
        var head = h('div', { class: 'mm-thead' });

        /* Live column widths. One array, read by the header and by every row,
           so a drag moves both together — a table whose header and body kept
           separate widths would drift apart the moment a row repainted. */
        var widths = opts.cols.map(function (c) { return c.w || '1 1 0'; });
        var headCells = [];

        /* Every rerender rebuilds this table, so a width that lived only in the
           DOM would be undone by the next click on anything. Keyed by where the
           table is and what its columns are, which is stable across rebuilds
           and unique per table without asking callers to name them. */
        var wKey = opts.key || $.safe(function () {
            var t = $.cfg.ui.tab || '';
            return t + ':' + (($.cfg.ui.sub || {})[t] || '') + ':' +
                opts.cols.map(function (c) { return c.label || ''; }).join(',');
        }, 'table key', '');
        (function () {
            var saved = wKey && $.cfg.ui.cols ? $.cfg.ui.cols[wKey] : null;
            if (saved && saved.length === widths.length) widths = saved.slice();
        }());
        function rememberWidths() {
            if (!wKey) return;
            if (!$.cfg.ui.cols) $.cfg.ui.cols = {};
            $.cfg.ui.cols[wKey] = widths.slice();
            $.store.saveSettings();
        }

        function applyWidths() {
            for (var i = 0; i < headCells.length; i++) headCells[i].style.flex = widths[i];
            var trs = table.querySelectorAll('.mm-tr');
            for (var r = 0; r < trs.length; r++) {
                var tds = trs[r].children;
                for (var c = 0; c < tds.length && c < widths.length; c++) tds[c].style.flex = widths[c];
            }
        }

        /**
         * Drag a column edge.
         *
         * The dragged column is pinned to an explicit pixel basis and so is
         * every column to its LEFT — otherwise a flexible neighbour absorbs
         * the change and the edge does not move at all. Columns to the right
         * are left as they are, so the last flexible one still takes up the
         * slack.
         */
        var MIN_COL = 24;
        function grip(i) {
            var g = h('div', { class: 'mm-colgrip', tip: 'Drag|Resize · double-click to reset' });
            g.addEventListener('pointerdown', function (e) {
                e.preventDefault(); e.stopPropagation();
                g.setPointerCapture(e.pointerId);
                g.classList.add('mm-dragging');
                var startX = e.clientX;
                var scale = ($.cfg.ui && $.cfg.ui.scale) || 1;
                var startW = headCells.map(function (el) { return el.getBoundingClientRect().width / scale; });
                for (var k = 0; k <= i; k++) widths[k] = '0 0 ' + Math.round(startW[k]) + 'px';
                function mv(ev) {
                    var w = Math.max(MIN_COL, startW[i] + (ev.clientX - startX) / scale);
                    widths[i] = '0 0 ' + Math.round(w) + 'px';
                    applyWidths();
                }
                function up() {
                    g.classList.remove('mm-dragging');
                    g.removeEventListener('pointermove', mv);
                    g.removeEventListener('pointerup', up);
                    g.removeEventListener('pointercancel', up);
                    rememberWidths();
                    U.refitPaths();   // middle-ellipsis is measured, so it goes stale
                }
                g.addEventListener('pointermove', mv);
                g.addEventListener('pointerup', up);
                g.addEventListener('pointercancel', up);
            });
            g.addEventListener('dblclick', function (e) {
                e.stopPropagation();
                widths = opts.cols.map(function (c) { return c.w || '1 1 0'; });
                applyWidths(); rememberWidths();
            });
            return g;
        }

        opts.cols.forEach(function (c, i) {
            // The header carries the column's own class as well: without it a
            // numeric column right-aligned its cells under a left-aligned
            // header, and the two read as misaligned even though the boxes
            // agreed to the pixel.
            var th = h('div', { class: 'mm-td ' + (c.cls || ''), style: 'flex:' + widths[i] });
            addCell(th, c.label);
            if (i < opts.cols.length - 1) th.appendChild(grip(i));
            headCells.push(th);
            head.appendChild(th);
        });
        var body = h('div', { class: 'mm-tbody' });
        var table = h('div', { class: 'mm-table' }, head, body);
        var rows = [];
        var virtual = !!opts.virtual;
        var spacerTop = null, spacerBot = null, viewport = null;

        function buildRow(r, i) {
            var tr = h('div', { class: 'mm-tr' });
            var cells = opts.render(r, i);
            for (var ci = 0; ci < opts.cols.length; ci++) {
                var c = opts.cols[ci];
                var td = h('div', { class: 'mm-td ' + (c.cls || ''), style: 'flex:' + widths[ci] });
                addCell(td, cells[ci]);
                tr.appendChild(td);
            }
            if (opts.onRow) opts.onRow(tr, r, i);
            return tr;
        }

        function paintPlain() {
            clear(body);
            if (!rows.length) { body.appendChild(h('div', { class: 'mm-empty', text: opts.empty || 'no matches' })); return; }
            rows.forEach(function (r, i) { body.appendChild(buildRow(r, i)); });
        }

        /**
         * Build the spacer/viewport skeleton ONCE and keep it.
         *
         * The original version rebuilt it on every paint, and clearing the body
         * drops scrollHeight to zero, which makes the browser clamp scrollTop
         * to 0. On macOS that is catastrophic: momentum scrolling keeps
         * delivering deltas, each one lands on a list that has just been reset
         * to the top, and the list appears to accelerate away and never stop.
         * Dragging the scrollbar thumb does the same thing — the thumb snaps to
         * the top, the pointer is still lower down, and the browser scrolls to
         * follow it, forever.
         */
        var lastFirst = -1, lastLen = -1;

        function ensureSkeleton() {
            if (spacerTop && spacerTop.parentNode === body) return;
            clear(body);
            spacerTop = h('div', { style: 'height:0' });
            viewport = h('div', {});
            spacerBot = h('div', { style: 'height:0' });
            body.appendChild(spacerTop);
            body.appendChild(viewport);
            body.appendChild(spacerBot);
            lastFirst = -1;
        }

        function paintVirtual() {
            if (!rows.length) {
                clear(body);
                spacerTop = viewport = spacerBot = null;
                lastFirst = -1; lastLen = 0;
                body.appendChild(h('div', { class: 'mm-empty', text: opts.empty || 'no matches' }));
                return;
            }
            var keepScroll = body.scrollTop;
            var rebuilt = !spacerTop || spacerTop.parentNode !== body;
            ensureSkeleton();
            if (rows.length !== lastLen) lastFirst = -1;   // window contents shifted
            lastLen = rows.length;
            renderWindow(true);
            // Restore the position the user was at. Clamp, because the row set
            // may have shrunk under them (a filter chip, a search keystroke).
            if (rebuilt || body.scrollTop !== keepScroll) {
                var max = Math.max(0, rows.length * ROW_H - body.clientHeight);
                body.scrollTop = Math.min(keepScroll, max);
            }
        }

        function renderWindow(force) {
            if (!viewport || !rows.length) return;
            var h0 = body.clientHeight || 200;
            var first = Math.max(0, Math.floor(body.scrollTop / ROW_H) - 6);
            var count = Math.ceil(h0 / ROW_H) + 12;
            var last = Math.min(rows.length, first + count);
            // Scrolling within the already-rendered window is free.
            if (!force && first === lastFirst) return;
            lastFirst = first;
            spacerTop.style.height = (first * ROW_H) + 'px';
            spacerBot.style.height = ((rows.length - last) * ROW_H) + 'px';
            clear(viewport);
            for (var i = first; i < last; i++) viewport.appendChild(buildRow(rows[i], i));
        }

        var scrolledAt = 0;
        if (virtual) {
            body.addEventListener('scroll', function () {
                scrolledAt = Date.now();
                $.safe(function () { renderWindow(false); }, 'virtual table scroll');
            });
        }

        function paint(next) {
            rows = next || [];
            $.safe(virtual ? paintVirtual : paintPlain, 'table paint');
        }

        table.mm = {
            paint: paint,
            /** Current flex bases, so a caller can save or restore a layout. */
            widths: function (next) {
                if (next && next.length === widths.length) { widths = next.slice(); applyWidths(); }
                return widths.slice();
            },
            refresh: function () { $.safe(function () { virtual ? renderWindow(true) : paintPlain(); }, 'table refresh'); },
            rows: function () { return rows; },
            /** True while the user is mid-gesture; auto-repaints should hold off. */
            isScrolling: function () { return Date.now() - scrolledAt < 400; },
            body: body, head: head, rowHeight: ROW_H,
            scrollToIndex: function (i) {
                body.scrollTop = Math.max(0, i * ROW_H - body.clientHeight / 2);
                if (virtual) renderWindow(true);
            }
        };
        return table;
    }

    /* click-to-edit mono cell; blocked in read-only mode */
    function mmEditCell(value, onCommit, cls) {
        var span = h('span', { class: (cls || 'mm-td-val') + ' mm-gated', text: String(value), style: 'cursor:text' });
        span.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!$.allowWrite('Editing this cell')) return;
            var inp = h('input', { class: 'mm-cellinput', value: span.textContent });
            span.replaceWith(inp); inp.focus(); inp.select();
            var settled = false;
            function done(commit) {
                if (settled || !inp.parentNode) return;
                settled = true;
                var v = inp.value, old = span.textContent;
                inp.replaceWith(span);
                if (commit && v !== old) { span.textContent = v; $.safe(function () { onCommit(v, old); }, 'edit cell commit'); }
            }
            inp.addEventListener('keydown', function (ev) {
                ev.stopPropagation();
                if (ev.key === 'Enter') done(true);
                if (ev.key === 'Escape') done(false);
            });
            inp.addEventListener('blur', function () { done(true); });
        });
        span.mm = { set: function (v) { span.textContent = String(v); } };
        return span;
    }

    /* ---------------------------------------------------------------------
       PATHS AND OTHER UNBOUNDED VALUES

       A row's right-hand side is `flex:0 0 auto`, which is right for a button
       and wrong for a string: an absolute path is longer than the whole column
       and cannot shrink, so it pushes the label out and is then clipped by the
       column's own overflow. Every panel that printed one grew its own copy of
       the problem; this is the one place it is solved.

       ELLIPSISED FROM THE MIDDLE, AND BY MEASUREMENT. text-overflow keeps the
       head, and the head of every path here is the part that says nothing —
       what distinguishes one install, slot or folder from another is the tail.
       The CSS direction:rtl trick does not do it: a leading '/' is
       bidi-neutral, so it puts the ellipsis at the front and still clips the
       tail. A binary search over scrollWidth does, in about seven iterations,
       once per mount.

       Four things it does that a bare string does not:
         · the complete value on the NATIVE title attribute, which survives the
           overlay's own tooltip layer and can be read by the OS;
         · selectable text, opted back in on MV where the engine sets
           user-select:none on the whole body;
         · a copy button, through the one clipboard helper, that says so when
           there is no clipboard rather than doing nothing;
         · with no value it prints the REASON, not a dash.
       ------------------------------------------------------------------ */

    /**
     * Fit `full` into `el` by eliding its middle.
     *
     * clientWidth is 0 while the node is detached, so this is a no-op until the
     * box has a width and callers refit after mount. It always re-derives from
     * the full string, so repeated calls cannot compound the truncation.
     */
    function fitMiddle(el, full) {
        return $.safe(function () {
            el.textContent = full;
            var avail = el.clientWidth;
            if (!avail || el.scrollWidth <= avail) return full;
            var lo = 0, hi = full.length, best = '…', mid, head, tail, s;
            while (lo <= hi) {
                mid = (lo + hi) >> 1;
                head = Math.ceil(mid / 2);
                tail = mid - head;
                s = full.slice(0, head) + '…' + (tail ? full.slice(full.length - tail) : '');
                el.textContent = s;
                if (el.scrollWidth <= avail) { best = s; lo = mid + 1; }
                else { hi = mid - 1; }
            }
            el.textContent = best;
            return best;
        }, 'fit path', full);
    }

    /**
     * mmPath(value, opts) → an .mm-edge holding one long value.
     *
     * opts.why       what to say INSTEAD when there is no value — name what is
     *                missing and why, not '—'
     * opts.fallback  a literal to show when there is no path but a meaningful
     *                name still exists (a bare file name, say)
     * opts.prefix    a short leading token kept whole and never elided
     * opts.copy      false to leave the copy button off
     */
    function mmPath(value, opts) {
        opts = opts || {};
        var full = (value === null || value === undefined) ? '' : String(value);
        var edge = h('div', {
            class: 'mm-edge mm-edge--shrink mm-sub' + (opts.mono === false ? '' : ' mm-mono')
        });

        if (!full) {
            if (opts.fallback) {
                edge.appendChild(h('span', {
                    class: 'mm-path mm-selectable', text: opts.fallback, title: opts.fallback
                }));
            } else {
                edge.classList.add('mm-edge--wrap');
                edge.appendChild(h('span', {
                    style: 'color:var(--mm-warn)',
                    text: opts.why || 'not resolved on this install'
                }));
            }
            edge.mm = { refit: function () { }, full: function () { return ''; }, set: function () { } };
            return edge;
        }

        if (opts.prefix) edge.appendChild(h('span', { class: 'mm-sub', text: opts.prefix }));
        var span = h('span', { class: 'mm-path mm-selectable', text: full, title: full });
        edge.appendChild(span);

        if (opts.copy !== false) {
            var btn = h('button', {
                class: 'mm-copy', text: '⧉', tip: 'Copy|The whole value, not the shortened one'
            });
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var ok = U.copyText(span.getAttribute('title'));
                if (ok) btn.classList.add('mm-ok');
                mmToast(ok
                    ? { title: opts.copyLabel || 'COPIED', msg: 'on the clipboard', severity: 'ok', ms: 1400 }
                    : { title: 'NO CLIPBOARD', msg: 'select it and copy it by hand', severity: 'warn' });
                setTimeout(function () { btn.classList.remove('mm-ok'); }, 1200);
            });
            edge.appendChild(btn);
        }

        function refit() { fitMiddle(span, span.getAttribute('title') || ''); }
        edge.mm = {
            refit: refit,
            full: function () { return span.getAttribute('title') || ''; },
            set: function (v) {
                var t = String(v == null ? '' : v);
                span.setAttribute('title', t);
                refit();
            }
        };
        // Measurement needs a mounted node with a width.
        requestAnimationFrame(function () { refit(); });
        return edge;
    }

    /** A whole row: label on the left, the value handled by mmPath on the right. */
    function mmPathRow(label, value, opts) {
        opts = opts || {};
        var edge = mmPath(value, opts);
        var row = h('div', { class: 'mm-row', tip: opts.tip || null },
            h('div', { class: 'mm-lab', text: label }), edge);
        row.mm = edge.mm;
        return row;
    }

    /**
     * Re-measure every path on screen.
     *
     * Middle-ellipsis is measured, so it goes stale the moment a column, a
     * split or the window changes width. Each of those already has one place
     * that runs when the drag ends; this is what they call.
     */
    U.refitPaths = function (root) {
        $.safe(function () {
            var scope = root || (HOST && HOST.root) || document;
            if (!scope.querySelectorAll) return;
            var n = scope.querySelectorAll('.mm-edge--shrink');
            for (var i = 0; i < n.length; i++) {
                if (n[i].mm && n[i].mm.refit) n[i].mm.refit();
            }
        }, 'refit paths');
    };

    function mmToast(o) {
        o = o || {};
        if (!HOST || !HOST.toasts) { $.log(o.severity === 'err' ? 'err' : 'info', (o.title || '') + ' ' + (o.msg || '')); return null; }
        var ms = o.ms || 3400;
        var bar = h('i', { class: 'mm-toast-bar' });
        if (o.severity === 'err') bar.style.background = 'var(--mm-danger)';
        if (o.severity === 'ok') bar.style.background = 'var(--mm-ok)';
        if (o.severity === 'warn') bar.style.background = 'var(--mm-warn)';
        var prog = h('i', { class: 'mm-toast-prog', style: 'animation-duration:' + ms + 'ms;background:' + bar.style.background });
        var el = h('div', { class: 'mm-toast' },
            h('div', { class: 'mm-toast-bd' }, bar,
                h('div', {}, h('div', { class: 'mm-toast-t', text: o.title || 'GIGAHACK' }),
                    o.msg ? h('div', { class: 'mm-toast-m', text: o.msg }) : null)),
            prog);
        HOST.toasts.appendChild(el);
        while (HOST.toasts.children.length > 4) HOST.toasts.firstChild.remove();
        var t = setTimeout(kill, ms);
        function kill() { clearTimeout(t); el.classList.add('mm-out'); setTimeout(function () { el.remove(); }, 170); }
        el.addEventListener('click', kill);
        return el;
    }

    function mmLog(sev, msg) {
        if (!HOST || !HOST.logBody) return;
        var row = h('div', { class: 'mm-log-row' },
            h('span', { class: 'mm-log-t', text: now() }),
            h('span', { class: 'mm-log-s mm-sev-' + sev, text: sev }),
            h('span', { class: 'mm-log-m', text: msg }));
        HOST.logBody.appendChild(row);
        while (HOST.logBody.children.length > 120) HOST.logBody.firstChild.remove();
        HOST.logBody.scrollTop = HOST.logBody.scrollHeight;
        if (HOST.logCount) HOST.logCount.textContent = HOST.logBody.children.length + ' lines';
    }

    /* layout helper — columns inside a tab body */
    /**
     * Body columns, with a draggable divider between each pair.
     *
     * The divider pins the column to its LEFT to a pixel basis and leaves the
     * one on the right flexible, so the split moves and the pair still fills
     * the body at any window width. Like the table widths, the position is
     * persisted per tab and sub — a rerender rebuilds this whole subtree, and
     * an un-persisted drag would be undone by the next click.
     */
    var SPLIT_MIN = 120;

    function cols() {
        var body = h('div', { class: 'mm-body' });
        var made = [];
        for (var i = 0; i < arguments.length; i++) {
            var c = arguments[i];
            var col = h('div', { class: 'mm-col' + (c && c.narrow ? ' mm-col-narrow' : '') });
            add(col, (c && c.items) || c);
            made.push(col);
            if (i > 0) body.appendChild(splitter(body, made, i - 1));
            body.appendChild(col);
        }
        if (made.length > 1) $.safe(function () { restoreSplits(made); }, 'restore splits');
        return body;
    }

    function splitKey(index) {
        return $.safe(function () {
            var t = $.cfg.ui.tab || '';
            return t + ':' + (($.cfg.ui.sub || {})[t] || '') + ':' + index;
        }, 'split key', '');
    }

    function restoreSplits(made) {
        for (var i = 0; i < made.length - 1; i++) {
            var key = splitKey(i);
            var px = key && $.cfg.ui.split ? $.cfg.ui.split[key] : null;
            if (px > 0) made[i].style.flex = '0 0 ' + px + 'px';
        }
    }

    function splitter(body, made, index) {
        var el = h('div', { class: 'mm-split', tip: 'Drag|Double-click to reset' });
        el.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            el.setPointerCapture(e.pointerId);
            el.classList.add('mm-dragging');
            var left = made[index], right = made[index + 1];
            var scale = ($.cfg.ui && $.cfg.ui.scale) || 1;
            var startX = e.clientX;
            var startW = left.getBoundingClientRect().width / scale;
            // The right-hand column is made flexible for the duration, or a
            // narrow sidebar on that side refuses to give any ground and the
            // divider appears stuck.
            var rightFlex = right.style.flex;
            right.style.flex = '1 1 0';
            function mv(ev) {
                var total = body.getBoundingClientRect().width / scale;
                var w = clamp(startW + (ev.clientX - startX) / scale, SPLIT_MIN, Math.max(SPLIT_MIN, total - SPLIT_MIN));
                left.style.flex = '0 0 ' + Math.round(w) + 'px';
            }
            function up() {
                el.classList.remove('mm-dragging');
                el.removeEventListener('pointermove', mv);
                el.removeEventListener('pointerup', up);
                el.removeEventListener('pointercancel', up);
                right.style.flex = rightFlex;
                U.refitPaths();       // both columns changed width
                var key = splitKey(index);
                if (key) {
                    if (!$.cfg.ui.split) $.cfg.ui.split = {};
                    $.cfg.ui.split[key] = Math.round(left.getBoundingClientRect().width / scale);
                    $.store.saveSettings();
                }
            }
            el.addEventListener('pointermove', mv);
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        });
        el.addEventListener('dblclick', function () {
            made[index].style.flex = '';
            var key = splitKey(index);
            if (key && $.cfg.ui.split) { delete $.cfg.ui.split[key]; $.store.saveSettings(); }
        });
        return el;
    }

    /* placeholder body for milestones that are not built yet */
    function mmTodo(milestone, title, lines) {
        var box = h('div', { class: 'mm-body' },
            h('div', { class: 'mm-todo' },
                h('div', { class: 'mm-todo-ms', text: milestone }),
                h('b', { text: title }),
                h('div', { style: 'text-align:center;line-height:1.9' },
                    (lines || []).map(function (l) { return h('div', { text: l }); }))));
        return box;
    }

    /* =====================================================================
       5. EXPORT
       ===================================================================== */
    U.CSS = CSS;
    U.CSS2 = CSS2;
    U.ICON = ICON;
    U.h = h; U.add = add; U.clear = clear; U.clamp = clamp; U.svg = svg; U.now = now;
    U.openPopup = openPopup; U.closePopup = closePopup;
    U.initTooltips = initTooltips; U.makeDraggable = makeDraggable;
    U.prettyCode = prettyCode;
    U.applyAccent = applyAccent;

    /* =====================================================================
       ACCENT CYCLING

       This used to be the one thing worth keeping on a "Toys" panel. It is not
       a toy — it is an appearance setting, so it sits with the other
       appearance settings and its code sits with the accent it writes.

       It touches exactly one CSS custom property on the overlay's own root.
       Nothing in the game is read or written.
       ===================================================================== */
    var cycleRaf = 0, cycleHue = 0, cycleLast = 0;

    function hslHex(hh, ss, ll) {
        var s = ss / 100, l = ll / 100;
        var c = (1 - Math.abs(2 * l - 1)) * s;
        var x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
        var m = l - c / 2;
        var r = 0, g = 0, b = 0;
        if (hh < 60) { r = c; g = x; }
        else if (hh < 120) { r = x; g = c; }
        else if (hh < 180) { g = c; b = x; }
        else if (hh < 240) { g = x; b = c; }
        else if (hh < 300) { r = x; b = c; }
        else { r = c; b = x; }
        function hx(v) { var n = Math.round((v + m) * 255); return (n < 16 ? '0' : '') + n.toString(16); }
        return '#' + hx(r) + hx(g) + hx(b);
    }

    function cycleTick(now) {
        cycleRaf = 0;
        var host = U.getHost && U.getHost();
        var root = host && host.root;
        // A loop left running behind a detached root is a frame of work per
        // frame of game, forever, and the only symptom is that the game feels
        // slightly worse the longer it has been open.
        if (!root || !root.isConnected || !U.accentCycling()) { stopCycle(); return; }
        var dt = cycleLast ? Math.min(100, now - cycleLast) : 16;
        cycleLast = now;
        cycleHue = (cycleHue + dt * 0.04 * (Number($.cfg.ui.accentCycleSpeed) || 1)) % 360;
        applyAccent(root, hslHex(cycleHue, 62, 64));
        cycleRaf = requestAnimationFrame(cycleTick);
    }

    function stopCycle() {
        if (cycleRaf) cancelAnimationFrame(cycleRaf);
        cycleRaf = 0; cycleLast = 0;
    }

    U.accentCycling = function () { return !!($.cfg.ui && $.cfg.ui.accentCycle); };

    /** Start or stop the loop to match the setting. Safe to call any time. */
    U.syncAccentCycle = function () {
        return $.safe(function () {
            var host = U.getHost && U.getHost();
            var root = host && host.root;
            if (!root) return false;
            if (U.accentCycling()) {
                if (!cycleRaf) { cycleLast = 0; cycleRaf = requestAnimationFrame(cycleTick); }
                return true;
            }
            stopCycle();
            // Straight back to the chosen accent, not to whatever hue the loop
            // happened to stop on.
            applyAccent(root, $.cfg.ui.accent);
            return false;
        }, 'accent cycle', false);
    };

    U.setAccentCycling = function (on) {
        $.store.cfgSet('ui.accentCycle', !!on);
        U.syncAccentCycle();
        return !!on;
    };

    U.accentCycleRunning = function () { return !!cycleRaf; };

    // Never found already cycling. It repaints a CSS variable every frame; a
    // launch that came up mid-rave reads as a broken overlay rather than as a
    // setting someone chose.
    $.safe(function () {
        $.store.unsafeAtBoot('ui.accentCycle',
            'it repaints the accent every frame — a launch that came up mid-rave reads as broken');
    }, 'register unsafe accent cycle');
    U.hexToRgb = hexToRgb;
    U.icon = iconEl;
    U.iconsReady = ensureIconSheet;
    U.setHost = function (host) { HOST = host; U.host = host; };

    /**
     * Report CSS features this renderer lacks that the overlay might have
     * wanted. The floor is Chromium 66 — MV 1.6 ships NW.js 0.29 — and the
     * stylesheet is written to it, so on a correct build every probe above the
     * last two reads "no" and nothing is wrong. That is the point: a
     * missing layout property does not degrade gracefully, it collapses the
     * overlay to nothing, so the boot report names what is absent instead of
     * leaving "the menu looks wrong" to be diagnosed by eye. Anything that
     * probes false here must not appear in the stylesheet.
     */
    U.compatReport = function () {
        var probes = [
            ['inset shorthand', 'inset', '0px'],
            ['color-mix()', 'color', 'color-mix(in srgb, red 50%, blue)'],
            ['aspect-ratio', 'aspect-ratio', '1'],
            ['flexbox gap', 'gap', '4px'],
            ['min()', 'width', 'min(10px, 20px)'],
            ['clamp()', 'width', 'clamp(1px, 2px, 3px)'],
            ['two-stop gradient', 'background',
                'repeating-linear-gradient(-45deg,transparent 0 2px,#000 2px 3px)'],
            ['custom properties', '--x', '1'],
            ['position:sticky', 'position', 'sticky']
        ];
        var out = [];
        probes.forEach(function (p) {
            var ok;
            try { ok = !!(window.CSS && CSS.supports && CSS.supports(p[1], p[2])); }
            catch (e) { ok = false; }
            out.push({ feature: p[0], supported: ok });
        });
        return out;
    };
    U.getHost = function () { return HOST; };
    U.toast = mmToast;
    U.logRow = mmLog;
    /**
     * Copy to the clipboard, or say it could not.
     *
     * nw.Clipboard first: a desktop build runs from file://, which is not a
     * secure context, and navigator.clipboard is gated behind one — so the
     * browser API is the fallback, not the first choice. It is still tried,
     * because a web-deployed build has no nw at all. Three modules had their
     * own copy of this before 1.0.
     */
    U.copyText = function (text) {
        return $.safe(function () {
            if (typeof nw !== 'undefined' && nw.Clipboard) {
                nw.Clipboard.get().set(String(text), 'text');
                return true;
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                /* It answers with a promise, and it rejects for reasons the
                   caller cannot see coming — the page is not focused, the
                   permission was refused, the document is not a secure
                   context. Unhandled, that surfaces as a console error nobody
                   can attribute and the toast still says COPIED. Handled, it
                   says which one. */
                var r = navigator.clipboard.writeText(String(text));
                if (r && typeof r.then === 'function') {
                    r.then(null, function (e) {
                        $.log('warn', 'the clipboard refused the write — ' +
                            ((e && e.message) || e) + '. Select the value and copy it by hand.');
                    });
                }
                return true;
            }
            return false;
        }, 'clipboard', false);
    };

    U.cols = cols;
    U.todo = mmTodo;
    U.w = {
        checkbox: mmCheckbox, slider: mmSlider, number: mmNumber, text: mmText,
        search: mmSearch, dropdown: mmDropdown, keybind: mmKeybind, color: mmColor,
        button: mmButton, chip: mmChip, row: mmRow, toggleRow: mmToggleRow,
        group: mmGroup, table: mmTable, editCell: mmEditCell, ungated: ungated,
        textarea: mmTextarea, path: mmPath, pathRow: mmPathRow
    };

    $.log('info', 'ui: design system ready (' + Object.keys(U.w).length + ' widget factories)');

})(window.GigaHack);
