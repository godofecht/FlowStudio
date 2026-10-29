/* Render bounded mathematical Flow observations as a real local SVG line graph. */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const MAX_SAMPLES = 130;
  const SERIES = Object.freeze({
    kineticEnergy: "Kinetic energy",
    maximumDivergence: "Maximum divergence",
    meanTemperature: "Mean temperature",
    temperatureVariance: "Temperature variance"
  });
  function prepare(result) {
    if (!result || result.ok !== true || !Array.isArray(result.observations))
      throw new TypeError("Successful mathematical Flow observations are required.");
    const rows = result.observations;
    if (rows.length < 2 || rows.length > MAX_SAMPLES)
      throw new RangeError("Observation series must contain 2–130 samples.");
    const metrics = ("kinetic_energy" in result)
      ? ["kineticEnergy", "maximumDivergence"]
      : ("temperature_variance" in result)
        ? ["temperatureVariance", "meanTemperature"] : null;
    if (!metrics) throw new TypeError("Unsupported mathematical Flow result.");
    const times = [];
    const values = Object.fromEntries(metrics.map(metric => [metric, []]));
    for (const row of rows) {
      if (!row || typeof row.time !== "number" || !Number.isFinite(row.time) ||
          (times.length && row.time <= times[times.length - 1]))
        throw new TypeError("Observation times must be finite and strictly increasing.");
      times.push(row.time);
      for (const metric of metrics) {
        if (typeof row[metric] !== "number" || !Number.isFinite(row[metric]))
          throw new TypeError("Observation values must be finite numbers.");
        values[metric].push(row[metric]);
      }
    }
    if (times[0] !== 0 || !Number.isFinite(result.time) ||
        Math.abs(times[times.length - 1] - result.time) > 1e-9 * Math.max(1, result.time))
      throw new TypeError("Observation endpoints do not match the simulation.");
    return Object.freeze({ times, values, metrics });
  }
  function coordinates(series, metric) {
    if (!series.metrics.includes(metric)) throw new TypeError("Unknown metric.");
    const values = series.values[metric], times = series.times;
    const minimum = Math.min(...values), maximum = Math.max(...values);
    const scale = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
    const scaledMinimum = minimum / scale;
    const range = (maximum / scale - scaledMinimum) || 0.1;
    const start = times[0], duration = times[times.length - 1] - start;
    const points = values.map((value, index) => [
      54 + 548 * (times[index] - start) / duration,
      200 - 172 * (value / scale - scaledMinimum) / range
    ]);
    return { points, minimum, maximum,
      path: points.map(([x, y], index) => (index ? "L" : "M") +
        x.toFixed(3) + "," + y.toFixed(3)).join(" ") };
  }
  function prepareSpatial(result) {
    const spatial = result?.spatial;
    if (!spatial) return null;
    const grid = spatial.grid, sourceGrid = spatial.source_grid, extent = spatial.extent;
    if (!Array.isArray(grid) || grid.length !== 2 ||
        !grid.every(n => Number.isInteger(n) && n >= 2 && n <= 24) ||
        !Array.isArray(sourceGrid) || sourceGrid.length !== 2 ||
        !sourceGrid.every((n, i) => Number.isInteger(n) && n >= grid[i] && n <= 512) ||
        !Array.isArray(extent) || extent.length !== 2 ||
        !extent.every(n => typeof n === "number" && Number.isFinite(n) && n > 0))
      throw new TypeError("Invalid bounded spatial grid or extent.");
    const fields = spatial.fields;
    const names = ("temperature_variance" in result) ? ["temperature"] :
      ("kinetic_energy" in result) ? ["vorticity", "velocity_x", "velocity_y"] : null;
    if (!names || !fields || typeof fields !== "object" ||
        Object.keys(fields).length !== names.length ||
        !names.every(name => Object.hasOwn(fields, name)))
      throw new TypeError("Unexpected mathematical Flow spatial fields.");
    for (const name of names) {
      const rows = fields[name];
      if (!Array.isArray(rows) || rows.length !== grid[0] ||
          !rows.every(row => Array.isArray(row) && row.length === grid[1] &&
            row.every(value => typeof value === "number" && Number.isFinite(value))))
        throw new TypeError("Spatial field values must be finite and match the grid.");
    }
    return { grid, sourceGrid, extent, fields, names };
  }
  function renderSpatial(doc, result) {
    const spatial = prepareSpatial(result);
    if (!spatial) return null;
    const [nx, ny] = spatial.grid;
    const field = spatial.fields[spatial.names[0]];
    const values = field.flat();
    const minimum = Math.min(...values), maximum = Math.max(...values);
    const scale = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
    const range = (maximum / scale - minimum / scale) || 1;
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 480 480");
    svg.setAttribute("width", "100%");
    svg.setAttribute("role", "img");
    svg.setAttribute("data-mathflow-spatial", "true");
    svg.setAttribute("aria-label", spatial.names[0] === "temperature" ?
      "Spatial temperature heatmap" : "Spatial vorticity heatmap and velocity vector field");
    const cellWidth = 480 / nx, cellHeight = 480 / ny;
    for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) {
      const normalized = Math.max(0, Math.min(1, (field[ix][iy] / scale - minimum / scale) / range));
      const cell = doc.createElementNS(NS, "rect");
      cell.setAttribute("x", String(ix * cellWidth));
      cell.setAttribute("y", String((ny - 1 - iy) * cellHeight));
      cell.setAttribute("width", String(cellWidth + 0.05));
      cell.setAttribute("height", String(cellHeight + 0.05));
      cell.setAttribute("fill", "rgb(" + Math.round(30 + 210 * normalized) + "," +
        Math.round(55 + 90 * (1 - Math.abs(2 * normalized - 1))) + "," +
        Math.round(225 - 185 * normalized) + ")");
      svg.append(cell);
    }
    if (spatial.names.includes("velocity_x")) {
      const u = spatial.fields.velocity_x, v = spatial.fields.velocity_y;
      const maxSpeed = Math.max(1e-12, ...u.flat().map((value, i) =>
        Math.hypot(value, v.flat()[i])));
      const stride = Math.max(1, Math.ceil(Math.max(nx, ny) / 12));
      for (let ix = 0; ix < nx; ix += stride) for (let iy = 0; iy < ny; iy += stride) {
        const speed = Math.hypot(u[ix][iy], v[ix][iy]);
        if (!speed) continue;
        const x = (ix + 0.5) * cellWidth, y = (ny - iy - 0.5) * cellHeight;
        const length = 0.38 * Math.min(cellWidth, cellHeight) * speed / maxSpeed;
        const arrow = doc.createElementNS(NS, "line");
        arrow.setAttribute("x1", String(x));
        arrow.setAttribute("y1", String(y));
        arrow.setAttribute("x2", String(x + length * u[ix][iy] / speed));
        arrow.setAttribute("y2", String(y - length * v[ix][iy] / speed));
        arrow.setAttribute("stroke", "#ffffff");
        arrow.setAttribute("stroke-width", "1.7");
        svg.append(arrow);
        const directionX = u[ix][iy] / speed, directionY = -v[ix][iy] / speed;
        const tipX = x + length * directionX, tipY = y + length * directionY;
        const head = Math.min(3.0, length * 0.4);
        const wing = head * 0.5;
        const points = [
          [tipX, tipY],
          [tipX - head * directionX - wing * directionY,
           tipY - head * directionY + wing * directionX],
          [tipX - head * directionX + wing * directionY,
           tipY - head * directionY - wing * directionX]
        ];
        const arrowHead = doc.createElementNS(NS, "polygon");
        arrowHead.setAttribute("points", points.map(point => point.join(",")).join(" "));
        arrowHead.setAttribute("fill", "#ffffff");
        svg.append(arrowHead);
      }
    }
    return svg;
  }
  const TRACE_ROLES = Object.freeze(["diffusion", "crossDiffusion", "advection", "reaction", "forcing"]);
  function prepareSemanticTrace(result) {
    const trace = result?.semantic_trace;
    if (trace === undefined) return null;
    const finite = value => typeof value === "number" && Number.isFinite(value);
    if (trace?.schema === 2) {
      if (trace.field !== "velocity" || trace.integrator !== "RungeKuttaSecondOrder" ||
          trace.rateUnit !== "m/s²" || !finite(trace.timeStep) || trace.timeStep <= 0 ||
          !Array.isArray(trace.stages) || trace.stages.length !== 2 ||
          !Array.isArray(trace.projections) || trace.projections.length !== 3)
        throw new TypeError("Invalid Navier-Stokes semantic trace.");
      for (const [index, stage] of trace.stages.entries()) {
        if (!stage || stage.name !== (index ? "predictorSlope" : "initialSlope") ||
            !finite(stage.time) ||
            Math.abs(stage.time - index * trace.timeStep) > 1e-9 * Math.max(1, trace.timeStep) ||
            !finite(stage.rhsRms) || stage.rhsRms < 0 ||
            !finite(stage.maximumDecompositionResidual) || stage.maximumDecompositionResidual < 0 ||
            !Array.isArray(stage.terms) || stage.terms.length !== 2)
          throw new TypeError("Invalid Navier-Stokes RK2 stage.");
        for (const [termIndex, term] of stage.terms.entries()) {
          if (!term || term.role !== (termIndex ? "diffusion" : "advection") ||
              term.sign !== 1 || typeof term.meaning !== "string" ||
              term.meaning.length < 1 || term.meaning.length > 256 ||
              !Array.isArray(term.symbols) || term.symbols.length > 8 ||
              !term.symbols.every(symbol => typeof symbol === "string" &&
                /^[A-Za-z_][A-Za-z_0-9]*$/.test(symbol) && symbol.length <= 64) ||
              !Array.isArray(term.dimension) || term.dimension.length !== 4 ||
              term.dimension.some((power, i) => power !== [1, 0, -2, 0][i]) ||
              !finite(term.meanMagnitude) || term.meanMagnitude < 0 ||
              !finite(term.maximumMagnitude) || term.maximumMagnitude < term.meanMagnitude)
            throw new TypeError("Invalid Navier-Stokes semantic term.");
        }
      }
      for (const [index, projection] of trace.projections.entries()) {
        if (!projection || projection.name !== ["initial", "predictor", "corrector"][index] ||
            !["maximumDivergenceBefore", "maximumDivergenceAfter", "correctionRms"]
              .every(key => finite(projection[key]) && projection[key] >= 0) ||
            !finite(projection.pressureMean))
          throw new TypeError("Invalid Navier-Stokes pressure projection.");
      }
      const update = trace.update;
      if (!update || !["initialKineticEnergy", "predictorKineticEnergy",
                         "updatedKineticEnergy", "maximumCorrectorDifference"]
            .every(key => finite(update[key]) && update[key] >= 0))
        throw new TypeError("Invalid Navier-Stokes RK2 update.");
      return trace;
    }
    if (!trace || trace.schema !== 1 || trace.field !== "temperature" ||
        trace.integrator !== "RungeKuttaSecondOrder" || trace.rateUnit !== "K/s" ||
        !finite(trace.timeStep) || trace.timeStep <= 0 ||
        !Array.isArray(trace.stages) || trace.stages.length !== 2)
      throw new TypeError("Invalid mathematical Flow semantic trace.");
    const update = trace.update;
    if (!update || !["initialMean", "predictorMean", "updatedMean",
                      "maximumCorrectorDifference"].every(key => finite(update[key])) ||
        update.maximumCorrectorDifference < 0)
      throw new TypeError("Invalid semantic RK2 update.");
    for (const [index, stage] of trace.stages.entries()) {
      if (!stage || stage.name !== (index ? "predictorSlope" : "initialSlope") ||
          !finite(stage.time) || Math.abs(stage.time - index * trace.timeStep) >
            1e-9 * Math.max(1, trace.timeStep) ||
          !finite(stage.rhsMean) || !finite(stage.maximumDecompositionResidual) ||
          stage.maximumDecompositionResidual < 0 ||
          !Array.isArray(stage.terms) || stage.terms.length < 1 || stage.terms.length > 16)
        throw new TypeError("Invalid semantic RK2 stage.");
      for (const term of stage.terms) {
        if (!term || !TRACE_ROLES.includes(term.role) ||
            typeof term.meaning !== "string" || term.meaning.length > 256 ||
            ![-1, 1].includes(term.sign) ||
            typeof term.rootOperator !== "string" || term.rootOperator.length > 32 ||
            !Array.isArray(term.symbols) || term.symbols.length > 24 ||
            !term.symbols.every(symbol => typeof symbol === "string" &&
              /^[A-Za-z_][A-Za-z_0-9]*$/.test(symbol) && symbol.length <= 64) ||
            !Array.isArray(term.dimension) || term.dimension.length !== 4 ||
            term.dimension.some((power, i) => power !== [0, 0, -1, 1][i]) ||
            !["mean", "minimum", "maximum"].every(key => finite(term[key])) ||
            term.minimum > term.maximum)
          throw new TypeError("Invalid semantic equation term.");
      }
    }
    if (trace.stages[0].terms.length !== trace.stages[1].terms.length ||
        trace.stages[0].terms.some((term, index) =>
          term.role !== trace.stages[1].terms[index].role ||
          term.sign !== trace.stages[1].terms[index].sign))
      throw new TypeError("RK2 stages must evaluate the same validated equation.");
    return trace;
  }
  function renderSemanticTrace(doc, result) {
    const trace = prepareSemanticTrace(result);
    if (!trace) return null;
    if (trace.schema === 2) {
      const section = doc.createElement("section");
      section.setAttribute("data-mathflow-semantic", "navier-rk2");
      const heading = doc.createElement("h3");
      heading.textContent = "Navier-Stokes · measured first RK2 step";
      const label = doc.createElement("label");
      label.textContent = "Stage ";
      const select = doc.createElement("select");
      select.setAttribute("aria-label", "Mathematical Flow semantic stage");
      for (const [index, name] of ["Initial slope", "Predictor slope"].entries()) {
        const option = doc.createElement("option");
        option.value = String(index);
        option.textContent = name;
        select.append(option);
      }
      label.append(select);
      const details = doc.createElement("p");
      const terms = doc.createElement("ol");
      function showStage() {
        const stage = trace.stages[Number(select.value)];
        details.textContent = "t = " + stage.time.toPrecision(6) +
          " s · velocity RHS RMS = " + stage.rhsRms.toPrecision(6) +
          " m/s² · decomposition residual = " +
          stage.maximumDecompositionResidual.toExponential(2) + " m/s²";
        terms.replaceChildren();
        for (const term of stage.terms) {
          const item = doc.createElement("li");
          item.textContent = term.role + " · " + term.meaning +
            " (" + term.symbols.join(", ") + ")" +
            " · mean magnitude " + term.meanMagnitude.toPrecision(6) +
            " m/s² · maximum " + term.maximumMagnitude.toPrecision(6) + " m/s²";
          terms.append(item);
        }
      }
      select.addEventListener("change", showStage);
      const projections = doc.createElement("ol");
      for (const projection of trace.projections) {
        const item = doc.createElement("li");
        item.textContent = projection.name + " pressure projection · divergence " +
          projection.maximumDivergenceBefore.toExponential(3) + " → " +
          projection.maximumDivergenceAfter.toExponential(3) +
          " 1/s · correction RMS " + projection.correctionRms.toExponential(3) +
          " m/s · pressure mean " + projection.pressureMean.toExponential(3) + " Pa";
        projections.append(item);
      }
      const update = doc.createElement("p");
      update.textContent = "RK2 kinetic energy: " +
        trace.update.initialKineticEnergy.toPrecision(6) + " → predictor " +
        trace.update.predictorKineticEnergy.toPrecision(6) + " → corrected " +
        trace.update.updatedKineticEnergy.toPrecision(6) +
        " J/m (per unit depth) · maximum unprojected corrector difference " +
        trace.update.maximumCorrectorDifference.toExponential(3) + " m/s";
      section.append(heading, label, details, terms, projections, update);
      showStage();
      return section;
    }
    const section = doc.createElement("section");
    section.setAttribute("data-mathflow-semantic", "rk2");
    const heading = doc.createElement("h3");
    heading.textContent = "Mathematical execution · first RK2 step";
    const label = doc.createElement("label");
    label.textContent = "Stage ";
    const select = doc.createElement("select");
    select.setAttribute("aria-label", "Mathematical Flow semantic stage");
    for (const [index, name] of ["Initial slope", "Predictor slope"].entries()) {
      const option = doc.createElement("option");
      option.value = String(index);
      option.textContent = name;
      select.append(option);
    }
    label.append(select);
    const details = doc.createElement("p");
    const terms = doc.createElement("ol");
    function showStage() {
      const stage = trace.stages[Number(select.value)];
      details.textContent = "t = " + stage.time.toPrecision(6) +
        " s · mean ∂ₜtemperature = " + stage.rhsMean.toPrecision(6) +
        " K/s · decomposition residual = " +
        stage.maximumDecompositionResidual.toExponential(2) + " K/s";
      terms.replaceChildren();
      for (const term of stage.terms) {
        const item = doc.createElement("li");
        item.textContent = (term.sign < 0 ? "− " : "+ ") + term.role +
          " · " + term.meaning + " AST: " + term.rootOperator +
          " (" + term.symbols.join(", ") + ")" +
          " · mean " + term.mean.toPrecision(6) + " K/s" +
          " · range [" + term.minimum.toPrecision(5) + ", " +
          term.maximum.toPrecision(5) + "] K/s";
        terms.append(item);
      }
    }
    select.addEventListener("change", showStage);
    const update = doc.createElement("p");
    update.textContent = "RK2 mean: " + trace.update.initialMean.toPrecision(6) +
      " → predictor " + trace.update.predictorMean.toPrecision(6) +
      " → corrected " + trace.update.updatedMean.toPrecision(6) +
      " K · maximum predictor/corrector difference " +
      trace.update.maximumCorrectorDifference.toExponential(3) + " K";
    section.append(heading, label, details, terms, update);
    showStage();
    return section;
  }
  function render(doc, host, result) {
    const series = prepare(result);
    const heading = doc.createElement("h3");
    heading.textContent = "Mathematical Flow · numerical observations";
    const boundary = result.boundary_condition;
    let boundaryNote = null;
    if (boundary !== undefined) {
      if (boundary !== "Periodic" && boundary !== "Dirichlet" && boundary !== "Neumann" && boundary !== "Robin" && boundary !== "Mixed" && boundary !== "Faces")
        throw new TypeError("Unsupported mathematical Flow boundary metadata.");
      if (boundary === "Dirichlet" &&
          (typeof result.boundary_temperature !== "number" ||
           !Number.isFinite(result.boundary_temperature)))
        throw new TypeError("Invalid Dirichlet boundary temperature.");
      if (boundary === "Neumann" &&
          (typeof result.boundary_gradient !== "number" ||
           !Number.isFinite(result.boundary_gradient)))
        throw new TypeError("Invalid Neumann boundary gradient.");
      const validFace = face => !!face && (
        (face.type === "Periodic" && face.value === null) ||
        (["Dirichlet", "Neumann"].includes(face.type) &&
         typeof face.value === "number" && Number.isFinite(face.value)) ||
        (["DirichletProfile", "NeumannProfile"].includes(face.type) && typeof face.value === "string" &&
         face.value.length > 0 && face.value.length <= 4096) ||
        (face.type === "Robin" && Array.isArray(face.value) &&
         face.value.length === 2 && face.value.every(Number.isFinite) &&
         face.value[1] > 0) ||
        (face.type === "RobinProfile" && Array.isArray(face.value) &&
         face.value.length === 2 &&
         (typeof face.value[0] === "string"
           ? face.value[0].length > 0 && face.value[0].length <= 4096
           : typeof face.value[0] === "number" && Number.isFinite(face.value[0])) &&
         (typeof face.value[1] === "string"
           ? face.value[1].length > 0 && face.value[1].length <= 4096
           : typeof face.value[1] === "number" && Number.isFinite(face.value[1]) &&
             face.value[1] > 0)));
      const describeFace = face => face.type === "Periodic" ? "Periodic" :
        face.type === "DirichletProfile" ? "Dirichlet profile " + face.value :
        face.type === "NeumannProfile" ? "Neumann profile " + face.value :
        face.type === "Robin" ?
          "Robin ambient " + face.value[0] + " K, transfer length " + face.value[1] + " m" :
        face.type === "RobinProfile" ?
          "Robin ambient " + (typeof face.value[0] === "string" ? "profile " + face.value[0] : face.value[0] + " K") +
          ", transfer length " + (typeof face.value[1] === "string" ? "profile " + face.value[1] : face.value[1] + " m") :
          face.type + " " + face.value + (face.type === "Dirichlet" ? " K" : " K/m");
      if (boundary === "Faces") {
        const faces = result.boundary_faces;
        const names = ["x_min", "x_max", "y_min", "y_max"];
        if (!faces || typeof faces !== "object" ||
            Object.keys(faces).sort().join(",") !== [...names].sort().join(","))
          throw new TypeError("Invalid four-face boundary metadata.");
        for (const name of names) {
          const face = faces[name];
          if (!validFace(face))
            throw new TypeError("Invalid thermal face boundary.");
        }
        for (const [lower, upper] of [["x_min", "x_max"], ["y_min", "y_max"]]) {
          if ((faces[lower].type === "Periodic") !== (faces[upper].type === "Periodic"))
            throw new TypeError("Periodic face boundary must be paired.");
        }
      }
      if (boundary === "Mixed" || boundary === "Robin") {
        const axes = result.boundary_axes;
        if (!axes || typeof axes !== "object" || Object.keys(axes).sort().join(",") !== "x,y")
          throw new TypeError("Invalid mixed boundary axes.");
        for (const axis of ["x", "y"]) {
          const face = axes[axis];
          if (!validFace(face))
            throw new TypeError("Invalid mixed boundary condition.");
        }
        if (boundary === "Robin" && ["x", "y"].some(axis => !["Robin", "RobinProfile"].includes(axes[axis].type)))
          throw new TypeError("Uniform Robin boundary requires both axes to be Robin.");
      }
      boundaryNote = doc.createElement("p");
      boundaryNote.setAttribute("data-mathflow-boundary", boundary);
      boundaryNote.textContent = boundary === "Faces"
        ? "Boundary: " + ["x_min", "x_max", "y_min", "y_max"].map(name => {
          const face = result.boundary_faces[name];
          return name.replace("_", " ") + " " + describeFace(face);
        }).join("; ")
        : boundary === "Mixed" || boundary === "Robin"
        ? "Boundary: " + ["x", "y"].map(axis => {
          const face = result.boundary_axes[axis];
          return axis + " " + describeFace(face);
        }).join("; ")
        : boundary === "Dirichlet"
        ? "Boundary: Dirichlet at " + result.boundary_temperature + " K (all faces)"
        : boundary === "Neumann"
          ? "Boundary: Neumann outward gradient " + result.boundary_gradient + " K/m (all faces)"
          : "Boundary: periodic";
    }
    const label = doc.createElement("label");
    label.textContent = "Quantity ";
    const select = doc.createElement("select");
    select.setAttribute("aria-label", "Mathematical Flow plotted quantity");
    for (const metric of series.metrics) {
      const option = doc.createElement("option");
      option.value = metric;
      option.textContent = SERIES[metric];
      select.append(option);
    }
    label.append(select);
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 640 240");
    svg.setAttribute("role", "img");
    svg.setAttribute("width", "100%");
    svg.setAttribute("aria-label", "Numerical observation time series");
    function element(name, attributes, value) {
      const node = doc.createElementNS(NS, name);
      for (const [key, attribute] of Object.entries(attributes)) node.setAttribute(key, String(attribute));
      if (value !== undefined) node.textContent = value;
      svg.append(node);
      return node;
    }
    function draw() {
      svg.replaceChildren();
      const metric = select.value;
      const curve = coordinates(series, metric);
      svg.setAttribute("aria-label", SERIES[metric] + " over simulated time");
      element("line", { x1: 54, y1: 28, x2: 54, y2: 200, stroke: "#9db0cb" });
      element("line", { x1: 54, y1: 200, x2: 602, y2: 200, stroke: "#9db0cb" });
      element("path", { d: curve.path, fill: "none", stroke: "#8fb8ff", "stroke-width": 2 });
      element("text", { x: 54, y: 19, fill: "#e7edf8", "font-size": 12 },
        SERIES[metric] + " (" + curve.maximum.toPrecision(5) + " max)");
      element("text", { x: 54, y: 219, fill: "#9db0cb", "font-size": 11 }, "0 s");
      element("text", { x: 602, y: 219, fill: "#9db0cb", "font-size": 11, "text-anchor": "end" },
        series.times[series.times.length - 1].toPrecision(5) + " s");
      element("text", { x: 58, y: 194, fill: "#9db0cb", "font-size": 10 },
        curve.minimum.toPrecision(5));
    }
    select.addEventListener("change", draw);
    const spatialSvg = renderSpatial(doc, result);
    const semantic = renderSemanticTrace(doc, result);
    if (spatialSvg) {
      const spatialHeading = doc.createElement("h3");
      spatialHeading.textContent = "Final simulated spatial fields";
      host.replaceChildren(heading, ...(boundaryNote ? [boundaryNote] : []), label, svg,
        spatialHeading, spatialSvg, ...(semantic ? [semantic] : []));
    } else host.replaceChildren(heading, ...(boundaryNote ? [boundaryNote] : []),
      label, svg, ...(semantic ? [semantic] : []));
    host.hidden = false;
    draw();
    return series;
  }
  const api = Object.freeze({ prepare, coordinates, prepareSpatial, renderSpatial, prepareSemanticTrace, renderSemanticTrace, render });
  root.FlowStudioMathPlots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
