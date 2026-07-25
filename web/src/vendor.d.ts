// Minimal hand-written typing for the one vendored browser global
// (web/vendor/gsap.min.js, loaded by a plain <script> tag before the module) --
// just the two tweens fx.ts calls, so deno check needs no network and no npm
// type packages. It is optional on purpose: with no gsap the page still works,
// every animation degrading to a static element, so `gsap?` is the honest type.

interface GsapVars {
  [prop: string]: unknown;
}

interface Gsap {
  from(targets: unknown, vars: GsapVars): void;
  fromTo(targets: unknown, fromVars: GsapVars, toVars: GsapVars): void;
}

interface Window {
  gsap?: Gsap;
}
