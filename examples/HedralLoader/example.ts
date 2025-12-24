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
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;

let isLoading = false;
let loadedFileName: string | null = null;
let leftPanelOpen = true;
let rightPanelOpen = true;

// Initialize components
const components = new OBC.Components();

const worlds = components.get(OBC.Worlds);
const world = worlds.create<
  OBC.ShadowedScene,
  OBC.OrthoPerspectiveCamera,
  OBC.SimpleRenderer
>();

const container = document.getElementById("container")!;
world.renderer = new OBC.SimpleRenderer(components, container);
world.camera = new OBC.OrthoPerspectiveCamera(components);
await world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25);

// Store container reference for plane selection
const containerElement = container;

components.init();

world.scene = new OBC.ShadowedScene(components);
world.scene.three.background = null;

// Enable shadows on renderer
world.renderer.three.shadowMap.enabled = true;
world.renderer.three.shadowMap.type = THREE.PCFSoftShadowMap;

// Set up shadowed scene
world.scene.setup({
  shadows: {
    cascade: 1,
    resolution: 1024,
  },
});

const grid = components.get(OBC.Grids).create(world);
world.scene.distanceRenderer.excludedObjects.add(grid.three);

// Initialize Views component for 2D plan views
const views = components.get(OBC.Views);
views.world = world;
OBC.Views.defaultRange = 100;

// Initialize Raycasters for interactive plane selection
const casters = components.get(OBC.Raycasters);
const caster = casters.get(world);

// Initialize Clipper component for clipping planes
const clipper = components.get(OBC.Clipper);
clipper.enabled = true;

// Store scene reference for controls (will be used later)
let sceneInitialized = true;

// 2D Plan View state
let currentView: OBC.View | null = null;
let is2DViewActive = false;

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

world.camera.controls.addEventListener("rest", async () => {
  fragments.core.update(true);
  await world.scene.updateShadows();
});

fragments.list.onItemSet.add(async ({ value: model }) => {
  model.useCamera(world.camera.three);
  world.scene.three.add(model.object);
  fragments.core.update(true);
  updateModelInfo();
  
  // Enable shadows on model meshes and ensure materials support clipping
  model.tiles.onItemSet.add(({ value: mesh }) => {
    if ("isMesh" in mesh) {
      const mat = mesh.material;
      if (Array.isArray(mat) && mat[0]?.opacity === 1) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      } else if (!Array.isArray(mat) && (mat as THREE.Material)?.opacity === 1) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      // Ensure materials support clipping
      const renderer = world.renderer;
      if (renderer) {
        const clippingPlanes = renderer.clippingPlanes;
        if (Array.isArray(mat)) {
          for (const material of mat) {
            if (material) {
              material.clippingPlanes = clippingPlanes;
            }
          }
        } else if (mat) {
          (mat as THREE.Material).clippingPlanes = clippingPlanes;
        }
      }
    }
  });
  
  for (const child of model.object.children) {
    child.castShadow = true;
    child.receiveShadow = true;
  }
  
  // Update clipping planes for all meshes in the world
  // The Clipper component will automatically update materials when planes are created,
  // but we ensure new models get the current clipping planes set up
  const renderer = world.renderer;
  if (renderer) {
    renderer.updateClippingPlanes();
    const clippingPlanes = renderer.clippingPlanes;
    for (const mesh of world.meshes) {
      if (!mesh.material) continue;
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) {
          material.clippingPlanes = clippingPlanes;
        }
      } else {
        mesh.material.clippingPlanes = clippingPlanes;
      }
    }
  }
  
  await world.scene.updateShadows();
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

const clearAllModels = () => {
  const modelIds = [...fragments.list.keys()];
  for (const modelId of modelIds) {
    fragments.core.disposeModel(modelId);
  }
  updateFileIndicator(null);
  fragments.core.update(true);
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

clearBtn.addEventListener("click", () => {
  if (fragments.list.size > 0) {
    if (confirm("Are you sure you want to clear all loaded models?")) {
      clearAllModels();
    }
  }
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

// Keyboard shortcut for deleting clipping planes
window.addEventListener("keydown", (event) => {
  if (event.code === "Delete" || event.code === "Backspace") {
    if (clipper.enabled && clipper.list.size > 0) {
      clipper.delete(world);
    }
  }
});

// Double-click to create clipping plane
container.addEventListener("dblclick", async () => {
  if (clipper.enabled) {
    await clipper.create(world);
  }
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

// Theme Management
type Theme = 'cyberpunk' | 'cad' | 'gray';

const THEME_STORAGE_KEY = 'hedralLoader-theme';

function setTheme(theme: Theme) {
  document.body.className = document.body.className.replace(/theme-\w+/g, '');
  document.body.classList.add(`theme-${theme}`);
  
  // Update dropdown selection
  const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;
  if (themeSelect) {
    themeSelect.value = theme;
  }
  
  // Save to localStorage
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function initTheme() {
  // Load saved theme or default to cyberpunk
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
  const theme = savedTheme || 'cyberpunk';
  setTheme(theme);
}

// Initialize theme on load
initTheme();

// Add event listener for theme dropdown
const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;
if (themeSelect) {
  themeSelect.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    setTheme(target.value as Theme);
  });
}

// 2D Plan View Functions
const switchTo2DPlanView = async (point?: THREE.Vector3, normal?: THREE.Vector3) => {
  if (!point || !normal) {
    // Default plan view from top (Y-up)
    point = new THREE.Vector3(0, 0, 0);
    normal = new THREE.Vector3(0, 1, 0);
  }
  
  // Invert normal so view looks down
  const invertedNormal = normal.clone().negate();
  
  // Close any existing view
  if (currentView) {
    views.close();
    views.list.delete(currentView.id);
  }
  
  // Create new plan view
  currentView = views.create(invertedNormal, point, {
    id: "PlanView",
    world,
  });
  
  // Set appropriate range
  currentView.range = 50;
  currentView.helpersVisible = false;
  
  // Open the view
  views.open("PlanView");
  is2DViewActive = true;
  
  // Update UI
  const planViewBtn = document.getElementById("planViewBtn") as HTMLButtonElement;
  if (planViewBtn) planViewBtn.textContent = "Switch to 3D";
};

const switchTo3DView = () => {
  if (currentView) {
    views.close();
    is2DViewActive = false;
    
    // Update UI
    const planViewBtn = document.getElementById("planViewBtn") as HTMLButtonElement;
    if (planViewBtn) planViewBtn.textContent = "Switch to 2D Plan";
  }
};

const togglePlanView = async () => {
  if (is2DViewActive) {
    switchTo3DView();
  } else {
    // Get center of loaded models for default plane position
    let centerPoint = new THREE.Vector3(0, 0, 0);
    if (fragments.list.size > 0) {
      const [model] = fragments.list.values();
      if (model) {
        model.box.getCenter(centerPoint);
      }
    }
    await switchTo2DPlanView(centerPoint, new THREE.Vector3(0, 1, 0));
  }
};


// Scene Configuration Controls
const createSceneControls = () => {
  const controlsDiv = document.createElement("div");
  controlsDiv.className = "scene-controls";
  controlsDiv.style.marginTop = "1.5rem";
  controlsDiv.style.paddingTop = "1.5rem";
  controlsDiv.style.borderTop = "1px solid var(--border-color)";

  const title = document.createElement("h3");
  title.className = "panel-title";
  title.style.marginBottom = "1rem";
  title.textContent = "Scene Settings";
  controlsDiv.appendChild(title);
  
  // 2D Plan View Controls
  const viewControlsDiv = document.createElement("div");
  viewControlsDiv.style.marginBottom = "1.5rem";
  
  const viewTitle = document.createElement("h3");
  viewTitle.className = "panel-title";
  viewTitle.style.marginBottom = "0.75rem";
  viewTitle.textContent = "2D Plan View";
  viewControlsDiv.appendChild(viewTitle);
  
  // Switch to 2D/3D button
  const planViewBtn = document.createElement("button");
  planViewBtn.id = "planViewBtn";
  planViewBtn.className = "btn-primary";
  planViewBtn.style.width = "100%";
  planViewBtn.textContent = "Switch to 2D Plan";
  planViewBtn.addEventListener("click", togglePlanView);
  viewControlsDiv.appendChild(planViewBtn);
  
  controlsDiv.appendChild(viewControlsDiv);

  // Clipping Planes Controls
  const clippingControlsDiv = document.createElement("div");
  clippingControlsDiv.style.marginBottom = "1.5rem";
  
  const clippingTitle = document.createElement("h3");
  clippingTitle.className = "panel-title";
  clippingTitle.style.marginBottom = "0.75rem";
  clippingTitle.textContent = "Clipping Planes";
  clippingControlsDiv.appendChild(clippingTitle);
  
  // Create clipping plane button
  const createClippingBtn = document.createElement("button");
  createClippingBtn.className = "btn-primary";
  createClippingBtn.style.width = "100%";
  createClippingBtn.style.marginBottom = "0.5rem";
  createClippingBtn.textContent = "Create Clipping Plane";
  createClippingBtn.addEventListener("click", async () => {
    if (clipper.enabled) {
      await clipper.create(world);
    }
  });
  clippingControlsDiv.appendChild(createClippingBtn);
  
  // Delete all clipping planes button
  const deleteAllClippingBtn = document.createElement("button");
  deleteAllClippingBtn.className = "btn-primary";
  deleteAllClippingBtn.style.width = "100%";
  deleteAllClippingBtn.style.marginBottom = "0.5rem";
  deleteAllClippingBtn.textContent = "Delete All Planes";
  deleteAllClippingBtn.addEventListener("click", () => {
    clipper.deleteAll();
  });
  clippingControlsDiv.appendChild(deleteAllClippingBtn);
  
  // Toggle clipping planes enabled
  const clippingEnabledControl = document.createElement("div");
  clippingEnabledControl.style.marginBottom = "0.5rem";
  
  const clippingEnabledLabel = document.createElement("label");
  clippingEnabledLabel.style.display = "flex";
  clippingEnabledLabel.style.alignItems = "center";
  clippingEnabledLabel.style.justifyContent = "space-between";
  clippingEnabledLabel.style.cursor = "pointer";
  clippingEnabledLabel.style.fontSize = "0.875rem";
  clippingEnabledLabel.style.color = "var(--text-secondary)";
  
  const clippingEnabledText = document.createElement("span");
  clippingEnabledText.textContent = "Clipping Enabled";
  
  const clippingEnabledCheckbox = document.createElement("input");
  clippingEnabledCheckbox.type = "checkbox";
  clippingEnabledCheckbox.id = "clippingEnabledCheckbox";
  clippingEnabledCheckbox.checked = clipper.enabled;
  clippingEnabledCheckbox.style.cursor = "pointer";
  clippingEnabledCheckbox.addEventListener("change", () => {
    clipper.enabled = clippingEnabledCheckbox.checked;
  });
  
  clippingEnabledLabel.appendChild(clippingEnabledText);
  clippingEnabledLabel.appendChild(clippingEnabledCheckbox);
  clippingEnabledControl.appendChild(clippingEnabledLabel);
  clippingControlsDiv.appendChild(clippingEnabledControl);
  
  // Clipping planes info
  const clippingInfo = document.createElement("p");
  clippingInfo.style.fontSize = "0.75rem";
  clippingInfo.style.color = "var(--text-muted)";
  clippingInfo.style.marginTop = "0.5rem";
  clippingInfo.textContent = "Double-click to create plane, Delete key to remove";
  clippingControlsDiv.appendChild(clippingInfo);
  
  controlsDiv.appendChild(clippingControlsDiv);


  // Lighting Options (Expandable)
  const lightingSection = document.createElement("div");
  lightingSection.style.marginBottom = "1rem";
  
  const lightingHeader = document.createElement("div");
  lightingHeader.style.display = "flex";
  lightingHeader.style.alignItems = "center";
  lightingHeader.style.justifyContent = "space-between";
  lightingHeader.style.cursor = "pointer";
  lightingHeader.style.padding = "0.5rem 0";
  lightingHeader.style.borderBottom = "1px solid var(--border-color)";
  lightingHeader.style.marginBottom = "0.75rem";
  
  const lightingTitle = document.createElement("h3");
  lightingTitle.className = "panel-title";
  lightingTitle.style.margin = "0";
  lightingTitle.style.fontSize = "0.875rem";
  lightingTitle.textContent = "Lighting";
  lightingHeader.appendChild(lightingTitle);
  
  const lightingToggle = document.createElement("span");
  lightingToggle.style.fontSize = "0.75rem";
  lightingToggle.style.color = "var(--accent-color)";
  lightingToggle.style.transition = "transform 0.2s";
  lightingToggle.textContent = "▼";
  lightingHeader.appendChild(lightingToggle);
  
  const lightingContent = document.createElement("div");
  lightingContent.id = "lightingContent";
  lightingContent.style.display = "none";
  lightingContent.style.paddingTop = "0.75rem";
  
  let lightingExpanded = false;
  lightingHeader.addEventListener("click", () => {
    lightingExpanded = !lightingExpanded;
    if (lightingExpanded) {
      lightingContent.style.display = "block";
      lightingToggle.textContent = "▲";
      lightingToggle.style.transform = "rotate(0deg)";
    } else {
      lightingContent.style.display = "none";
      lightingToggle.textContent = "▼";
      lightingToggle.style.transform = "rotate(0deg)";
    }
  });
  
  // Shadows Toggle (inside lighting section)
  const shadowsControl = document.createElement("div");
  shadowsControl.style.marginBottom = "1rem";
  
  const shadowsLabel = document.createElement("label");
  shadowsLabel.style.display = "flex";
  shadowsLabel.style.alignItems = "center";
  shadowsLabel.style.justifyContent = "space-between";
  shadowsLabel.style.cursor = "pointer";
  shadowsLabel.style.fontSize = "0.875rem";
  shadowsLabel.style.color = "var(--text-secondary)";
  
  const shadowsText = document.createElement("span");
  shadowsText.textContent = "Shadows";
  
  const shadowsCheckbox = document.createElement("input");
  shadowsCheckbox.type = "checkbox";
  shadowsCheckbox.id = "shadowsCheckbox";
  shadowsCheckbox.checked = world.scene.shadowsEnabled;
  shadowsCheckbox.style.cursor = "pointer";
  shadowsCheckbox.addEventListener("change", () => {
    world.scene.shadowsEnabled = shadowsCheckbox.checked;
  });
  
  shadowsLabel.appendChild(shadowsText);
  shadowsLabel.appendChild(shadowsCheckbox);
  shadowsControl.appendChild(shadowsLabel);
  lightingContent.appendChild(shadowsControl);
  
  // Ambient Light Intensity
  const ambientIntensityControl = document.createElement("div");
  ambientIntensityControl.style.marginBottom = "1rem";
  
  const ambientIntensityLabel = document.createElement("label");
  ambientIntensityLabel.style.display = "block";
  ambientIntensityLabel.style.fontSize = "0.75rem";
  ambientIntensityLabel.style.color = "var(--text-muted)";
  ambientIntensityLabel.style.marginBottom = "0.5rem";
  ambientIntensityLabel.textContent = "Ambient Light";
  ambientIntensityControl.appendChild(ambientIntensityLabel);
  
  const ambientIntensityInput = document.createElement("input");
  ambientIntensityInput.type = "range";
  ambientIntensityInput.id = "ambientIntensityInput";
  ambientIntensityInput.min = "0";
  ambientIntensityInput.max = "10";
  ambientIntensityInput.step = "0.1";
  ambientIntensityInput.value = world.scene.config.ambientLight.intensity.toString();
  ambientIntensityInput.style.width = "100%";
  ambientIntensityInput.style.cursor = "pointer";
  
  const ambientIntensityValue = document.createElement("span");
  ambientIntensityValue.style.display = "block";
  ambientIntensityValue.style.fontSize = "0.75rem";
  ambientIntensityValue.style.color = "var(--text-muted)";
  ambientIntensityValue.style.marginTop = "0.25rem";
  ambientIntensityValue.textContent = world.scene.config.ambientLight.intensity.toFixed(1);
  
  ambientIntensityInput.addEventListener("input", () => {
    const value = parseFloat(ambientIntensityInput.value);
    world.scene.config.ambientLight.intensity = value;
    ambientIntensityValue.textContent = value.toFixed(1);
  });
  
  ambientIntensityControl.appendChild(ambientIntensityInput);
  ambientIntensityControl.appendChild(ambientIntensityValue);
  lightingContent.appendChild(ambientIntensityControl);

  // Directional Light Intensity
  const directionalIntensityControl = document.createElement("div");
  directionalIntensityControl.style.marginBottom = "1rem";
  
  const directionalIntensityLabel = document.createElement("label");
  directionalIntensityLabel.style.display = "block";
  directionalIntensityLabel.style.fontSize = "0.75rem";
  directionalIntensityLabel.style.color = "var(--text-muted)";
  directionalIntensityLabel.style.marginBottom = "0.5rem";
  directionalIntensityLabel.textContent = "Directional Light";
  directionalIntensityControl.appendChild(directionalIntensityLabel);
  
  const directionalIntensityInput = document.createElement("input");
  directionalIntensityInput.type = "range";
  directionalIntensityInput.id = "directionalIntensityInput";
  directionalIntensityInput.min = "0";
  directionalIntensityInput.max = "10";
  directionalIntensityInput.step = "0.1";
  directionalIntensityInput.value = world.scene.config.directionalLight.intensity.toString();
  directionalIntensityInput.style.width = "100%";
  directionalIntensityInput.style.cursor = "pointer";
  
  const directionalIntensityValue = document.createElement("span");
  directionalIntensityValue.style.display = "block";
  directionalIntensityValue.style.fontSize = "0.75rem";
  directionalIntensityValue.style.color = "var(--text-muted)";
  directionalIntensityValue.style.marginTop = "0.25rem";
  directionalIntensityValue.textContent = world.scene.config.directionalLight.intensity.toFixed(1);
  
  directionalIntensityInput.addEventListener("input", () => {
    const value = parseFloat(directionalIntensityInput.value);
    world.scene.config.directionalLight.intensity = value;
    directionalIntensityValue.textContent = value.toFixed(1);
  });
  
  directionalIntensityControl.appendChild(directionalIntensityInput);
  directionalIntensityControl.appendChild(directionalIntensityValue);
  lightingContent.appendChild(directionalIntensityControl);

  // Shadow Resolution (inside lighting section)
  const shadowResControl = document.createElement("div");
  shadowResControl.style.marginBottom = "1rem";
  
  const shadowResLabel = document.createElement("label");
  shadowResLabel.style.display = "block";
  shadowResLabel.style.fontSize = "0.75rem";
  shadowResLabel.style.color = "var(--text-muted)";
  shadowResLabel.style.marginBottom = "0.5rem";
  shadowResLabel.textContent = "Shadow Resolution";
  shadowResControl.appendChild(shadowResLabel);
  
  const shadowResInput = document.createElement("input");
  shadowResInput.type = "range";
  shadowResInput.id = "shadowResInput";
  shadowResInput.min = "256";
  shadowResInput.max = "2048";
  shadowResInput.step = "256";
  shadowResInput.value = "1024";
  shadowResInput.style.width = "100%";
  shadowResInput.style.cursor = "pointer";
  
  const shadowResValue = document.createElement("span");
  shadowResValue.style.display = "block";
  shadowResValue.style.fontSize = "0.75rem";
  shadowResValue.style.color = "var(--text-muted)";
  shadowResValue.style.marginTop = "0.25rem";
  shadowResValue.textContent = `1024px`;
  
  shadowResInput.addEventListener("input", () => {
    const value = parseInt(shadowResInput.value);
    shadowResValue.textContent = `${value}px`;
    world.scene.setup({
      shadows: {
        cascade: 1,
        resolution: value,
      },
    });
    world.scene.updateShadows();
  });
  
  shadowResControl.appendChild(shadowResInput);
  shadowResControl.appendChild(shadowResValue);
  lightingContent.appendChild(shadowResControl);
  
  lightingSection.appendChild(lightingHeader);
  lightingSection.appendChild(lightingContent);
  controlsDiv.appendChild(lightingSection);

  return controlsDiv;
};

// Add scene controls to left panel
const sceneControls = createSceneControls();
leftPanelContent.appendChild(sceneControls);

