const STORE_KEY = "mitex_playground_v1";
const MAX_OUT = 200 * 1024;

const PY_SRC = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.js";
const CPP_SRC = [
  "https://raw.githubusercontent.com/felixhao28/JSCPP/gh-pages/dist/JSCPP.es5.min.js",
  "https://felixhao28.github.io/JSCPP/dist/JSCPP.es5.min.js",
];

const EXAMPLES = {
  python: {
    "Hello, MITEX": `print("Hello from Python inside MITEX!")
print("Game over")
print("Square sum:", sum(x * x for x in range(1, 11)))`,
    "FizzBuzz": `for i in range(1, 31):
    out = ""
    if i % 3 == 0: out += "Fizz"
    if i % 5 == 0: out += "Buzz"
    print(out or i)`,
    "Fibonacci (recursion)": `def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

for i in range(10):
    print(fib(i), end=" ")
print()`,
    "Lists & dictionary": `stock = {
    "Domains": 24,
    "Web templates": 7,
    "Web apps": 3,
}

for name, count in stock.items():
    print(f"{name}: {count}")

print("Total:", sum(stock.values()))`,
  },
  cpp: {
    "Hello, MITEX": `#include <iostream>
using namespace std;

int main() {
    cout << "Hello from C++ inside MITEX!" << endl;
    return 0;
}`,
    "FizzBuzz": `#include <iostream>
using namespace std;

int main() {
    for (int i = 1; i <= 30; i++) {
        if (i % 15 == 0) cout << "FizzBuzz" << endl;
        else if (i % 3 == 0) cout << "Fizz" << endl;
        else if (i % 5 == 0) cout << "Buzz" << endl;
        else cout << i << endl;
    }
    return 0;
}`,
    "Fibonacci (function)": `#include <iostream>
using namespace std;

int fib(int n) {
    return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

int main() {
    for (int i = 0; i < 10; i++) cout << fib(i) << " ";
    cout << endl;
    return 0;
}`,
    "Read from stdin": `#include <iostream>
using namespace std;

int main() {
    cout << "Enter a number:" << endl;
    int n;
    cin >> n;
    cout << "You typed " << n << ". Double is " << n * 2 << "." << endl;
    return 0;
}`,
  },
};

const FILE_LABEL = { python: "main.py", cpp: "main.cpp" };

let lang = "python";
let saved = null;
let pyodide = null;
let pyPromise = null;
let JSCPP = null;
let cppPromise = null;
let outBuf = "";
let outCapped = false;

const codeEl = document.getElementById("code");
const stdinEl = document.getElementById("stdin");
const outputEl = document.getElementById("output");
const runBtn = document.getElementById("runBtn");
const resetBtn = document.getElementById("resetBtn");
const exEl = document.getElementById("examples");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const codeLabel = document.getElementById("codeLabel");
const tabPython = document.getElementById("tabPython");
const tabCpp = document.getElementById("tabCpp");

function setStatus(text, busy) {
  statusText.textContent = text;
  statusEl.classList.toggle("busy", Boolean(busy));
  statusDot.className = "dot";
  if (busy) statusDot.classList.add("err");
}

function write(text) {
  if (outCapped) return;
  if (outBuf.length + text.length > MAX_OUT) {
    outBuf += "\n[output truncated]\n";
    outCapped = true;
    return;
  }
  outBuf += text;
  outputEl.textContent = outBuf;
  outputEl.scrollTop = outputEl.scrollHeight;
}

function resetOutput() {
  outBuf = "";
  outCapped = false;
  outputEl.textContent = "";
}

function loadScript(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  return new Promise((resolve, reject) => {
    const attempt = (i) => {
      if (i >= list.length) return reject(new Error("Could not load the runtime from the CDN. Check your connection and try again."));
      const s = document.createElement("script");
      s.src = list[i];
      s.onload = () => resolve();
      s.onerror = () => attempt(i + 1);
      document.head.appendChild(s);
    };
    attempt(0);
  });
}

function ensurePython() {
  if (pyodide) return Promise.resolve(pyodide);
  if (!pyPromise) {
    setStatus("Loading Python runtime (first run only)...", true);
    pyPromise = loadScript(PY_SRC)
      .then(() =>
        loadPyodide({
          stdout: (t) => write(t),
          stderr: (t) => write(t),
        })
      )
      .then((p) => {
        pyodide = p;
        setStatus("Python ready");
        return p;
      })
      .catch((e) => {
        pyPromise = null;
        throw e;
      });
  }
  return pyPromise;
}

function ensureCpp() {
  if (JSCPP) return Promise.resolve(JSCPP);
  if (!cppPromise) {
    setStatus("Loading C++ interpreter (first run only)...", true);
    cppPromise = loadScript(CPP_SRC)
      .then(() => {
        if (!window.JSCPP) throw new Error("C++ interpreter failed to initialise.");
        JSCPP = window.JSCPP;
        setStatus("C++ interpreter ready");
        return JSCPP;
      })
      .catch((e) => {
        cppPromise = null;
        throw e;
      });
  }
  return cppPromise;
}

async function run() {
  const code = codeEl.value.trim();
  if (!code) {
    resetOutput();
    write("Enter some code first, or pick an example.");
    return;
  }
  runBtn.disabled = true;
  resetOutput();
  try {
    if (lang === "python") {
      await ensurePython();
      const res = await pyodide.runPythonAsync(code);
      if (res !== undefined) write(String(res) + "\n");
    } else {
      await ensureCpp();
      const exit = JSCPP.run(code, stdinEl.value, {
        stdio: { write: (t) => write(t) },
      });
      if (exit !== 0) write("\n[exit code " + exit + "]\n");
    }
  } catch (e) {
    write((e && e.message) || String(e));
    write("\n");
  } finally {
    runBtn.disabled = false;
  }
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ lang, python: saved.python, cpp: saved.cpp }));
  } catch {}
}

function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (raw && typeof raw === "object") {
      saved = {
        python: typeof raw.python === "string" ? raw.python : null,
        cpp: typeof raw.cpp === "string" ? raw.cpp : null,
      };
      if (raw.lang === "python" || raw.lang === "cpp") lang = raw.lang;
      return;
    }
  } catch {}
  saved = { python: null, cpp: null };
}

function exampleLabel(code) {
  const list = EXAMPLES[lang];
  for (const key of Object.keys(list)) {
    if (list[key] === code) return key;
  }
  return "";
}

function buildSelect() {
  exEl.innerHTML = "";
  const keys = Object.keys(EXAMPLES[lang]);
  if (!exampleLabel(saved[lang])) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "\u2014 Custom program \u2014";
    exEl.appendChild(opt);
  }
  keys.forEach((k) => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    exEl.appendChild(opt);
  });
  const cur = exampleLabel(saved[lang]);
  exEl.value = cur;
}

function setLang(next) {
  if (next === lang) return;
  saved[lang] = codeEl.value;
  lang = next;
  codeEl.value = saved[lang] || Object.values(EXAMPLES[lang])[0];
  saved[lang] = codeEl.value;
  codeLabel.textContent = FILE_LABEL[lang];
  tabPython.classList.toggle("active", lang === "python");
  tabPython.setAttribute("aria-selected", String(lang === "python"));
  tabCpp.classList.toggle("active", lang === "cpp");
  tabCpp.setAttribute("aria-selected", String(lang === "cpp"));
  buildSelect();
  persist();
}

exEl.addEventListener("change", () => {
  const key = exEl.value;
  if (key && EXAMPLES[lang][key]) {
    codeEl.value = EXAMPLES[lang][key];
    saved[lang] = codeEl.value;
    persist();
  }
});

codeEl.addEventListener("input", () => {
  saved[lang] = codeEl.value;
  persist();
});

runBtn.addEventListener("click", run);
resetBtn.addEventListener("click", resetOutput);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    run();
  }
});

tabPython.addEventListener("click", () => setLang("python"));
tabCpp.addEventListener("click", () => setLang("cpp"));

loadSaved();
if (!saved[lang]) saved[lang] = Object.values(EXAMPLES[lang])[0];
codeEl.value = saved[lang];
codeLabel.textContent = FILE_LABEL[lang];
buildSelect();
setStatus("Pick an example or write code, then press Run.");