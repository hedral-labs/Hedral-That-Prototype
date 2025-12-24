import Stats from "stats.js";
// @ts-ignore - Vite resolves this at runtime via alias configuration
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";

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
});


const downloadFragments = async () => {
  const [model] = fragments.list.values();
  if (!model) return;
  const fragsBuffer = await model.getBuffer(false);
  const file = new File([fragsBuffer], "school_str.frag");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
};

BUI.Manager.init();

const componentResult = BUI.Component.create<BUI.PanelSection, {}>(() => {
  let downloadBtn: BUI.TemplateResult | undefined;
  if (fragments.list.size > 0) {
    downloadBtn = BUI.html`
      <bim-button label="Download Fragments" @click=${downloadFragments}></bim-button>
    `;
  }

  let loadBtn: BUI.TemplateResult | undefined;
  if (fragments.list.size === 0) {
    const onUploadIfc = async (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        await ifcLoader.load(buffer, false, file.name, {
          processData: {
            progressCallback: (progress) => console.log(progress),
          },
        });
      } catch (error) {
        console.error("Failed to load IFC:", error);
        alert(`Failed to load IFC file: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
        // Reset input
        input.value = "";
      }
    };

    loadBtn = BUI.html`
      <bim-label>Upload IFC File:</bim-label>
      <input type="file" accept=".ifc" @change=${onUploadIfc} style="margin-top: 0.5rem; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; width: 100%;" />
      <bim-label>Open the console to see the progress!</bim-label>
    `;
  }

  return BUI.html`
    <bim-panel active label="HedralLoader Tutorial" class="options-menu">
      <bim-panel-section label="Controls">
        ${loadBtn}
        ${downloadBtn}
      </bim-panel-section>
    </bim-panel>
  `;
}, {});

// Handle both array and single element return types
const panel = Array.isArray(componentResult) ? componentResult[0] : componentResult;
const updatePanel = Array.isArray(componentResult) ? componentResult[1] : () => {};

document.body.append(panel);
fragments.list.onItemSet.add(() => {
  if (typeof updatePanel === 'function') {
    updatePanel();
  }
});

const button = BUI.Component.create<BUI.PanelSection>(() => {
  return BUI.html`
      <bim-button class="phone-menu-toggler" icon="solar:settings-bold"
        @click="${() => {
          if (panel.classList.contains("options-menu-visible")) {
            panel.classList.remove("options-menu-visible");
          } else {
            panel.classList.add("options-menu-visible");
          }
        }}">
      </bim-button>
    `;
});

document.body.append(button);

const stats = new Stats();
stats.showPanel(2);
document.body.append(stats.dom);
stats.dom.style.left = "0px";
stats.dom.style.zIndex = "unset";
world.renderer.onBeforeUpdate.add(() => stats.begin());
world.renderer.onAfterUpdate.add(() => stats.end());

