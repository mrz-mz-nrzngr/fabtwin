/**
 * A sample OPC UA server for the bridge: an address space with a FabTwin folder, one object per tool and
 * the variables the convention names (State, LotId, Recipe, Route, StepIndex, Alarm.critical.TOOL_FAULT,
 * Measurement.CD ...). Values move because scripts/lib/minifab.ts runs lots through the tools.
 * It is built on node-opcua's server, so it is a real OPC UA endpoint, but its contents are simulated.
 *
 *   npm run sample-server            opc.tcp://localhost:48410/UA/FabTwin
 */
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DataType, OPCUACertificateManager, OPCUAServer, StatusCodes, Variant } from "node-opcua";
import type { UAVariable } from "node-opcua";
import { DEMO_TOOLS, MiniFab } from "../../../scripts/lib/minifab";

const PORT = Number(process.env.OPCUA_PORT ?? 48410);
const SEED = Number(process.env.SEED ?? 21);

async function main() {
  const server = new OPCUAServer({
    port: PORT,
    resourcePath: "/UA/FabTwin",
    buildInfo: { productName: "FabTwinSampleServer", buildNumber: "1", manufacturerName: "FabTwin" },
    allowAnonymous: true,
    // Keep the demo's certificates in a folder of its own, not in the shared per-user node-opcua folder.
    serverCertificateManager: new OPCUACertificateManager({ rootFolder: process.env.OPCUA_PKI ?? join(tmpdir(), "fabtwin-opcua-pki-server"), automaticallyAcceptUnknownCertificate: true }),
  });
  await server.initialize();
  const space = server.engine.addressSpace!;
  const ns = space.getOwnNamespace();
  const root = ns.addFolder(space.rootFolder.objects, { browseName: "FabTwin" });

  type Vars = Record<string, UAVariable>;
  const vars = new Map<string, Vars>();
  const set = (toolId: string, name: string, dataType: DataType, value: string | number | boolean) => {
    vars.get(toolId)![name].setValueFromSource(new Variant({ dataType, value }), StatusCodes.Good);
  };

  for (const t of DEMO_TOOLS) {
    const obj = ns.addObject({ organizedBy: root, browseName: t.id });
    const m: Vars = {};
    const make = (name: string, dt: "String" | "Double" | "Boolean" | "Int32", init: string | number | boolean) => {
      const v = ns.addVariable({ componentOf: obj, browseName: name, nodeId: `s=${t.id}.${name}`, dataType: dt });
      v.setValueFromSource(new Variant({ dataType: DataType[dt], value: init }), StatusCodes.Good);
      m[name] = v;
    };
    make("State", "String", "STANDBY");
    make("LotId", "String", "");
    make("Recipe", "String", "");
    make("Route", "String", "");
    make("StepIndex", "Int32", 0);
    make("Alarm.critical.TOOL_FAULT", "Boolean", false);
    if (t.bay === "METRO") for (const p of ["CD", "OVL", "THK"]) make(`Measurement.${p}`, "Double", 0);
    // A variable the bridge has no meaning for, to show that unknown names are reported and skipped.
    make("ChamberTemperature", "Double", 21 + (t.id.charCodeAt(4) % 5));
    vars.set(t.id, m);
  }
  await server.start();
  const ep = server.getEndpointUrl();
  console.log(`OPC UA sample server on ${ep} with ${DEMO_TOOLS.length} tools`);

  const fab = new MiniFab(
    { tools: DEMO_TOOLS, seed: SEED, releaseEveryS: 14, maxWip: 16, mtbfS: 900, repairS: 20 },
    {
      onStart(tool, lot, recipe) {
        set(tool.id, "Recipe", DataType.String, recipe);
        set(tool.id, "Route", DataType.String, lot.route.id);
        set(tool.id, "StepIndex", DataType.Int32, lot.step);
        set(tool.id, "LotId", DataType.String, lot.id);
        set(tool.id, "State", DataType.String, "PRODUCTIVE");
        return 8 + Math.random() * 8;
      },
      onMeasure(tool, param, value) {
        set(tool.id, `Measurement.${param}`, DataType.Double, value);
      },
      onFinish(tool) {
        set(tool.id, "State", DataType.String, "STANDBY");
        set(tool.id, "LotId", DataType.String, "");
      },
      onPhase(tool, phase) {
        set(tool.id, "State", DataType.String, phase);
      },
      onAlarm(tool, _code, active) {
        set(tool.id, "Alarm.critical.TOOL_FAULT", DataType.Boolean, active);
        console.log(`${tool.id} TOOL_FAULT ${active ? "set" : "cleared"}`);
      },
    },
  );
  // Initialise every variable once so subscribers get a first value.
  for (const t of DEMO_TOOLS) {
    set(t.id, "State", DataType.String, "STANDBY");
    set(t.id, "LotId", DataType.String, "");
  }
  fab.run(500);

  const stop = async () => {
    await server.shutdown(500);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
