/* Background picker: Keep original / Transparent / swatches / gradients / custom.
 * Value strings: "inherit" | "none" | "transparent" | "#rrggbb" | "grad|<deg>|#c1|#c2" */
const BG_SOLIDS = [["White", "#ffffff"], ["Light grey", "#e6e8ec"], ["Sky blue", "#8fbfe8"], ["ID blue", "#1a3a6b"], ["Red", "#c0392b"]];
const BG_GRADS = [["Sky", "grad|180|#dbeafe|#ffffff"], ["Studio", "grad|180|#f4f4f4|#c9ced6"], ["Dusk", "grad|180|#27395f|#131b33"], ["Sunrise", "grad|135|#ffe29f|#ff9a8b"]];

function bgCss(v) {
  if (v.startsWith("grad|")) { const [, a, c1, c2] = v.split("|"); return `linear-gradient(${a}deg, ${c1}, ${c2})`; }
  return v;
}

function createBgPicker(root, { value = "none", allowInherit = false, onChange = () => {} } = {}) {
  let current = value;
  const mk = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
  root.classList.add("bg-picker");
  const textRow = mk("div", "bg-row", root), swRow = mk("div", "bg-row", root), custom = mk("div", "bg-custom", root);
  const buttons = [];

  const add = (parent, label, val, cls) => {
    const b = mk("button", cls, parent);
    b.type = "button"; b.dataset.value = val; b.title = label; b.setAttribute("aria-label", label);
    if (cls === "bg-swatch") b.style.background = bgCss(val); else b.textContent = label;
    b.addEventListener("click", () => set(val, true));
    buttons.push(b);
  };
  if (allowInherit) add(textRow, "Same as all photos", "inherit", "bg-chip");
  add(textRow, "Keep original", "none", "bg-chip");
  add(textRow, "Transparent", "transparent", "bg-chip");
  BG_SOLIDS.forEach(([l, v]) => add(swRow, l, v, "bg-swatch"));
  BG_GRADS.forEach(([l, v]) => add(swRow, l + " gradient", v, "bg-swatch"));

  custom.innerHTML =
    `<label>Custom color <input type="color" class="bg-solid" value="#1a3a6b"></label>
     <label>Gradient <input type="color" class="bg-g1" value="#dbeafe"><input type="color" class="bg-g2" value="#ffffff">
       <select class="bg-dir"><option value="180">Top to bottom</option><option value="90">Left to right</option><option value="135">Diagonal</option></select></label>`;
  const solid = custom.querySelector(".bg-solid"), g1 = custom.querySelector(".bg-g1"), g2 = custom.querySelector(".bg-g2"), dir = custom.querySelector(".bg-dir");
  solid.addEventListener("change", () => set(solid.value, true));
  [g1, g2, dir].forEach((el) => el.addEventListener("change", () => set(`grad|${dir.value}|${g1.value}|${g2.value}`, true)));

  function refresh() {
    buttons.forEach((b) => b.classList.toggle("is-active", b.dataset.value === current));
    if (current.startsWith("grad|")) { const [, a, c1, c2] = current.split("|"); dir.value = a; g1.value = c1; g2.value = c2; }
    else if (/^#[0-9a-f]{6}$/i.test(current)) solid.value = current;
  }
  function set(v, fire) { current = v; refresh(); if (fire) onChange(v); }
  refresh();
  return { getValue: () => current, setValue: (v) => set(v, false) };
}
