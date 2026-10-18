
import type { ServerDiagnosticsGauge } from "./ServerDiagnosticsGauge.js";
import type { ServerDiagnosticsProcess } from "./ServerDiagnosticsProcess.js";

export type ServerDiagnosticsResponse = { process: ServerDiagnosticsProcess, gauges: Array<ServerDiagnosticsGauge>, };
