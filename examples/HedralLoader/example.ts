import Stats from "stats.js";
// @ts-ignore - Vite resolves this at runtime via alias configuration
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as THREE from "three";

// UI Elements
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const loadBtn = document.getElementById("loadBtn") as HTMLButtonElement;
const resetCameraBtn = document.getElementById("resetCameraBtn") as HTMLButtonElement;
const fitToViewBtn = document.getElementById("fitToViewBtn") as HTMLButtonElement;
const leftPanel = document.getElementById("leftPanel") as HTMLDivElement;
const rightPanel = document.getElementById("rightPanel") as HTMLDivElement;
const leftPanelToggle = document.getElementById("leftPanelToggle") as HTMLButtonElement;
const rightPanelToggle = document.getElementById("rightPanelToggle") as HTMLButtonElement;
const leftPanelContent = document.getElementById("leftPanelContent") as HTMLDivElement;
const loadingOverlay = document.getElementById("loadingOverlay") as HTMLDivElement;
const fileIndicator = document.getElementById("fileIndicator") as HTMLDivElement;
const fileName = document.getElementById("fileName") as HTMLSpanElement;
const modelInfo = document.getElementById("modelInfo") as HTMLDivElement;
const fpsStat = document.getElementById("fpsStat") as HTMLSpanElement;

let isLoading = false;
let loadedFileName: string | null = null;
let leftPanelOpen = true;
let rightPanelOpen = true;

// Initialize components
const components = new OBC.Components();

const worlds = components.get(OBC.Worlds);
const world = worlds.create<
  OBC.SimpleScene,
  OBC.OrthoPerspectiveCamera,
  OBC.SimpleRenderer
>();

world.scene = new OBC.SimpleScene(components);
world.scene.setup();
world.scene.three.background = null;

const container = document.getElementById("container")!;
world.renderer = new OBC.SimpleRenderer(components, container);
world.camera = new OBC.OrthoPerspectiveCamera(components);
await world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25);

components.init();

components.get(OBC.Grids).create(world);

const ifcLoader = components.get(OBC.IfcLoader);

ifcLoader.onIfcImporterInitialized.add((importer) => {
  console.log(importer.classes);
});

await ifcLoader.setup({
  autoSetWasm: false,
  wasm: {
    path: "https://unpkg.com/web-ifc@0.0.72/",
    absolute: true,
  },
});

// Fetch the worker and create a blob URL to avoid CORS issues
const githubUrl =
  "https://thatopen.github.io/engine_fragment/resources/worker.mjs";
const fetchedUrl = await fetch(githubUrl);
const workerBlob = await fetchedUrl.blob();
const workerFile = new File([workerBlob], "worker.mjs", {
  type: "text/javascript",
});
const workerUrl = URL.createObjectURL(workerFile);
const fragments = components.get(OBC.FragmentsManager);
fragments.init(workerUrl);

world.camera.controls.addEventListener("rest", () =>
  fragments.core.update(true),
);

fragments.list.onItemSet.add(({ value: model }) => {
  model.useCamera(world.camera.three);
  world.scene.three.add(model.object);
  fragments.core.update(true);
  updateModelInfo();
});

const downloadFragments = async () => {
  const [model] = fragments.list.values();
  if (!model) return;
  const fragsBuffer = await model.getBuffer(false);
  const file = new File([fragsBuffer], loadedFileName?.replace('.ifc', '.frag') || "model.frag");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
};

// UI Functions
const setLoading = (loading: boolean) => {
  isLoading = loading;
  if (loading) {
    loadingOverlay.classList.add("active");
    loadBtn.disabled = true;
  } else {
    loadingOverlay.classList.remove("active");
    loadBtn.disabled = false;
  }
};

const updateFileIndicator = (name: string | null) => {
  loadedFileName = name;
  if (name) {
    fileName.textContent = name;
    fileIndicator.style.display = "block";
  } else {
    fileIndicator.style.display = "none";
  }
  updateModelInfo();
};

const updateModelInfo = () => {
  if (loadedFileName) {
    const fileType = loadedFileName.endsWith('.ifc') ? 'IFC Model' : 'Fragment';
    const fragmentCount = fragments.list.size;
    modelInfo.innerHTML = `
      <div class="info-row">
        <span>File:</span>
        <span class="info-value">${loadedFileName}</span>
      </div>
      <div class="info-row">
        <span>Type:</span>
        <span class="info-value">${fileType}</span>
      </div>
      <div class="info-row">
        <span>Fragments:</span>
        <span class="info-value">${fragmentCount}</span>
      </div>
    `;
  } else {
    modelInfo.innerHTML = '<p style="text-align: center; color: var(--slate-600);">No model loaded</p>';
  }
};

const loadFile = async (file: File) => {
  setLoading(true);
  updateFileIndicator(file.name);

  try {
    if (file.name.endsWith('.ifc')) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      const modelId = file.name.replace('.ifc', '').replace(/[^a-zA-Z0-9]/g, '_');
      await ifcLoader.load(buffer, false, modelId, {
        processData: {
          progressCallback: (progress) => {
            console.log(`Loading progress: ${(progress * 100).toFixed(2)}%`);
          },
        },
      });
      console.log("IFC file loaded successfully");
    } else if (file.name.endsWith('.frag')) {
      const arrayBuffer = await file.arrayBuffer();
      const modelId = file.name.replace('.frag', '').replace(/[^a-zA-Z0-9]/g, '_');
      await fragments.core.load(arrayBuffer, { modelId });
      console.log("Fragment file loaded successfully");
    } else {
      throw new Error("Unsupported file type. Please use .ifc or .frag files.");
    }
  } catch (error) {
    console.error("Failed to load file:", error);
    alert(`Failed to load file: ${error instanceof Error ? error.message : "Unknown error"}`);
    updateFileIndicator(null);
  } finally {
    setLoading(false);
    fileInput.value = "";
  }
};

// Event Handlers
loadBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await loadFile(file);
  }
});

resetCameraBtn.addEventListener("click", () => {
  world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25);
});

fitToViewBtn.addEventListener("click", async () => {
  const [model] = fragments.list.values();
  if (model) {
    const box = model.box;
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    await world.camera.controls.fitToSphere(sphere, true);
  } else {
    world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25);
  }
});

leftPanelToggle.addEventListener("click", () => {
  leftPanelOpen = !leftPanelOpen;
  if (leftPanelOpen) {
    leftPanel.classList.remove("hidden");
  } else {
    leftPanel.classList.add("hidden");
  }
});

rightPanelToggle.addEventListener("click", () => {
  rightPanelOpen = !rightPanelOpen;
  if (rightPanelOpen) {
    rightPanel.classList.remove("hidden");
  } else {
    rightPanel.classList.add("hidden");
  }
});

// Initialize BUI
BUI.Manager.init();

const componentResult = BUI.Component.create<BUI.PanelSection, {}>(() => {
  let downloadBtn: BUI.TemplateResult | undefined;
  if (fragments.list.size > 0) {
    downloadBtn = BUI.html`
      <bim-button label="Download Fragments" @click=${downloadFragments}></bim-button>
    `;
  }

  return BUI.html`
    <bim-panel active label="HedralLoader Controls" class="options-menu">
      <bim-panel-section label="File Operations">
        ${downloadBtn}
        <bim-label style="margin-top: 1rem; color: var(--slate-500); font-size: 0.75rem;">
          Open the console to see loading progress!
        </bim-label>
      </bim-panel-section>
    </bim-panel>
  `;
}, {});

// Handle both array and single element return types
const panel = Array.isArray(componentResult) ? componentResult[0] : componentResult;
const updatePanel = Array.isArray(componentResult) ? componentResult[1] : () => {};

leftPanelContent.append(panel);
fragments.list.onItemSet.add(() => {
  if (typeof updatePanel === 'function') {
    updatePanel();
  }
  updateModelInfo();
});

// Stats.js setup
const stats = new Stats();
stats.showPanel(2);
document.body.append(stats.dom);
stats.dom.style.left = "0px";
stats.dom.style.zIndex = "unset";
world.renderer.onBeforeUpdate.add(() => stats.begin());
world.renderer.onAfterUpdate.add(() => stats.end());

// Update FPS display using renderer frame updates
let frameCount = 0;
let lastUpdateTime = performance.now();
const updateFPS = () => {
  frameCount++;
  const now = performance.now();
  const elapsed = now - lastUpdateTime;
  if (elapsed >= 1000) {
    const fps = Math.round((frameCount * 1000) / elapsed);
    fpsStat.textContent = `${fps} FPS`;
    frameCount = 0;
    lastUpdateTime = now;
  }
};
world.renderer.onAfterUpdate.add(updateFPS);

