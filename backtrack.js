let MarkerType = {
  AMEND: 0,
  ROOT_BEGIN: 1,
  ROOT_END: 2,
  INPUT_BEGIN: 3,
  INPUT_END: 4,
  OBJECTIVE: 5,
  DISPATCH: 6,
  REDISPATCH_BEGIN: 7,
  REDISPATCH_END: 8,
  EXECUTE_BEGIN: 9,
  EXECUTE_END: 10,
  REQUEST: 11,
  RESPONSE_BEGIN: 12,
  RESPONSE_END: 13,
  BRANCH: 14,
  SLEEP: 15,
  WAKE: 16,
  LABEL_BEGIN: 17,
  LABEL_END: 18,
  LOOP_BEGIN: 19,
  LOOP_END: 20,
  STARTUP: 21,
  INFO: 22,
  MILESTONE: 23,
  SIGNAL: 24,
  ACCEPT: 25,

  $: function(type) {
    for (let t in this) {
      if (this[t] === type) {
        return t.toString();
      }
    }
  },
};

let MarkerField = {
  NONE: 0,
  STATIC_NAME: 1,
  DYNAMIC_NAME: 2,
  BACKTRAIL: 3,
  PREVIOUS_SEQUENTIAL_DISPATCH: 4,
  PREVIOUS_EXECUTE: 5,
  TIMING: 6,
  QUEUE_NAME: 7,
};

class PlaceholderMarker {
  constructor() {
    this.type = MarkerType.NONE;
    this.time = 0;
    this.names = ["Placeholder for non-existent"];
    this.id = 0;
    this.tid = 0;
  }
}

class Thread {
  constructor(tid, process) {
    this.tid = tid;
    this.process = process;
    this.last = null;
    this.markers = [];
    this.rooting = [false];
  }

  addmarker(id, marker) {
    marker.id = parseInt(id);
    marker.names = [];
    marker.rooted = this.rooted();

    this.last = marker;
    this.markers.push(this.last);

    switch (marker.type) {
      case undefined:
        throw "No marker type?";
      case MarkerType.STARTUP:
      case MarkerType.EXECUTE_BEGIN:
      case MarkerType.RESPONSE_BEGIN:
      case MarkerType.REDISPATCH_BEGIN:
      case MarkerType.INPUT_BEGIN:
      case MarkerType.ROOT_BEGIN:
        this.rooting.push(true);
        break;
      case MarkerType.LOOP_BEGIN:
        this.rooting.push(false);
        break;
      case MarkerType.EXECUTE_END:
      case MarkerType.RESPONSE_END:
      case MarkerType.REDISPATCH_END:
      case MarkerType.INPUT_END:
      case MarkerType.ROOT_END:
        this.rooting.pop();
        break;
      case MarkerType.LOOP_END:
        this.rooting.pop();
        break;

    }
    return marker;
  }

  rooted() {
    return this.rooting.last() === true;
  }
}

class Backtrack {
  constructor() {
    this.objectives = [];
    this.processes = {};
    this.threads = {};
    this.startupmarkers = [];
  }

  assert(cond, msg) {
    if (!cond) {
      throw new Error(msg || "Assertion failure");
    }
  }

  assertNot(cond, msg) {
    this.assert(!cond, msg);
  }

  parseTime(timeString) {
    return parseFloat(timeString.replace(",", ".")) * 1000;
  }

  processLine(line, process) {
    let fullLine = line;

    let match = line.match(/^([^:]+):([^:]+):(.*)$/);
    if (!match) {
      return;
    }

    let tid = parseInt(match[1]);
    let id = match[2];

    if (isNaN(tid)) {
      if (this.last_name_amend) {
        this.last_name_amend.names.push(line.trim());
      }
      return;
    }

    this.last_name_amend = undefined;

    line = match[3];
    match = line.split(":");
    if (!match) {
      return;
    }

    let thread = ensure(this.threads, tid, () => { return new Thread(tid, process); });
    let result;

    if (id === "NT") {
      thread.name = `${match[0]}(${tid & 0xffff})`;
      if (!thread.time) {
        thread.time = match[1];
      }
    } else if (id === "NP") {
      process.name = `${match[0]}(${process.pid})`.replace('_', ':');
      process.type = match[0];
    } else { // Mark<>
      id = parseInt(id);
      let type = parseInt(match[0]);
      switch (type) {
        case MarkerType.AMEND:
          let field = parseInt(match[1]);
          switch (field) {
            case MarkerField.STATIC_NAME:
            case MarkerField.DYNAMIC_NAME:
              this.last_name_amend = this.get({ tid, id });
              this.last_name_amend.names.push(match.slice(2).join(":"));
              break;
            case MarkerField.PREVIOUS_SEQUENTIAL_DISPATCH:
              this.get({ tid, id }).pdisp_gid = {
                tid: parseInt(match[2]),
                id: parseInt(match[3])
              };
              break;
            case MarkerField.PREVIOUS_EXECUTE:
              this.get({ tid, id }).pexec_gid = {
                tid: parseInt(match[2]),
                id: parseInt(match[3])
              };
              break;
            case MarkerField.QUEUE_NAME:
              this.last_name_amend = this.get({ tid, id });
              this.last_name_amend.names.push(`[on queue: ${match.slice(2).join(":")}]`);
              break;
          }
          break;
        case MarkerType.OBJECTIVE:
          result = thread.addmarker(id, {
            tid,
            type,
            time: this.parseTime(match[1]),
          });
          this.objectives.push(thread.last);
          break;
        case MarkerType.STARTUP:
          result = thread.addmarker(id, {
            tid,
            type,
            time: this.parseTime(match[1]),
          });
          this.startupmarkers.push(thread.last);
          break;
        case MarkerType.INFO:
          result = thread.addmarker(id, {
            tid,
            type,
            time: this.parseTime(match[1]),
          });
          break;
        case MarkerType.DISPATCH:
        case MarkerType.REQUEST:
        case MarkerType.ROOT_BEGIN:
        case MarkerType.INPUT_BEGIN:
        case MarkerType.REDISPATCH_BEGIN:
        case MarkerType.EXECUTE_BEGIN:
        case MarkerType.RESPONSE_BEGIN:
        case MarkerType.LOOP_BEGIN:
        case MarkerType.LABEL_BEGIN:
        case MarkerType.ROOT_END:
        case MarkerType.INPUT_END:
        case MarkerType.REDISPATCH_END:
        case MarkerType.EXECUTE_END:
        case MarkerType.RESPONSE_END:
        case MarkerType.LOOP_END:
        case MarkerType.LABEL_END:
        case MarkerType.SLEEP:
        case MarkerType.WAKE:
        case MarkerType.MILESTONE:
        case MarkerType.SIGNAL:
        case MarkerType.ACCEPT:
          result = thread.addmarker(id, {
            tid,
            type,
            time: this.parseTime(match[1]),
            backtrail: {
              tid: parseInt(match[2]),
              id: parseInt(match[3])
            }
          });
          break;
        default:
          if (isNaN(type)) {
            break;
          }
          this.assert(false, `Missing new marker handler for ${type}, ${fullLine}`);
      }
    }

    return result;
  }

  sources(marker) {
    let labels = [];
    if (marker.type == MarkerType.LABEL_BEGIN) {
      // We want labels to have themselves as a source label, but can't do this inside
      // backtrack() as we would not be able to find the previous label in the loop below.
      labels.push(marker);
    }
    let label = marker.label;
    while (label && label.marker) {
      labels.push(label.marker);
      label = label.marker.label;
    }
    return labels;
  }

  sourcesDescriptor(marker, det = ">", limit) {
    return this.sources(marker).slice(0, limit).map(source => source.names.join("|")).join(det);
  }

  cacheForwardtrail() {
    for (let thread of Object.values(this.threads)) {
      for (let marker of thread.markers) {
        if (!marker.backtrail || !marker.backtrail.id) {
          continue;
        }
        this.get(marker.backtrail).forwardtrail = {
          tid: marker.tid,
          id: marker.id,
        }
      }
    }
  }

  get(gid) {
    if (!gid || !gid.id) {
      return new PlaceholderMarker();
    }
    let index = gid.id - 1; // we count from 1...
    this.assert(index >= 0, "get() with id < 0");
    // Can't enforce the following assertion until we gracefully close BT files on all processes
    /* this.assert(index < this.threads[gid.tid].markers.length); */
    let result = this.threads[gid.tid].markers[index] || new PlaceholderMarker();
    if (this.picker) {
      this.picker(gid.tid, index, result);
    }
    return result;
  }

  prev(marker) {
    return this.get({ tid: marker.tid, id: marker.id - 1 });
  }

  backtrail(marker) {
    this.assert(marker.backtrail, "Expected backtrail");
    this.assert(marker.backtrail.id, "Expected valid backtrail");
    let trail = this.get(marker.backtrail);
    switch (marker.type) {
      case MarkerType.REDISPATCH_END:
      case MarkerType.EXECUTE_END:
      case MarkerType.RESPONSE_END:
      case MarkerType.ROOT_END:
      case MarkerType.INPUT_END:
      case MarkerType.LOOP_END:
      case MarkerType.LABEL_END:
        this.assert(
          trail.type == marker.type - 1,
          "Expected *_BEGIN marker"
        );
        break;
      case MarkerType.REDISPATCH_BEGIN:
      case MarkerType.EXECUTE_BEGIN:
        this.assert(
          trail.type == MarkerType.DISPATCH ||
          trail.type == MarkerType.REDISPATCH_END ||
          trail.type == MarkerType.EXECUTE_END ||
          "Expected DISPATCH or *_END marker"
        );
        break;
      case MarkerType.RESPONSE_BEGIN:
        this.assert(
          trail.type == MarkerType.REQUEST ||
          trail.type == MarkerType.RESPONSE_END,
          "Expected REQUEST or *_END marker"
        );
        break;
    }
    return trail;
  }

  forwardtrail(source) {
    let forward_gid = this.get(source).forwardtrail;
    return this.get(forward_gid);
  }

  blockers(dispatch, execute_begin, collector) {
    let pexec_gid = execute_begin.pexec_gid;
    let up_to = this.forwardtrail(execute_begin);

    while (pexec_gid && pexec_gid.id) {
      let execute_begin = this.get(pexec_gid);
      let execute_end = this.forwardtrail(execute_begin);
      if (execute_end.time > dispatch.time && (execute_end.tid !== up_to.tid || execute_end.time < up_to.time)) {
        collector(this, execute_begin);
      }

      this.assert(pexec_gid.id !== execute_begin.pexec_gid.id || pexec_gid.tid !== execute_begin.pexec_gid.tid,
        `prev-exec loop to itself: gid_t = ${pexec_gid.tid}:${pexec_gid.id}`);
      pexec_gid = execute_begin.pexec_gid;
    }
  }

  *backtrack(tid, id, break_tid, break_id, skipNestedBlock = false) {
    let marker = this.get({ tid, id });
    const stop = this.get({ tid: break_tid, id: break_id });

    let lazyLabel = { marker: null };
    const result = (marker, props = {}) => {
      if (props.label || props.source) {
        lazyLabel.marker = marker;
        lazyLabel = { marker: null };
      } else {
        marker.label = lazyLabel;
      }

      return Object.assign({
        marker,
        className: '',
      }, props);
    }

    while (marker) {
      switch (marker.type) {
        case MarkerType.ROOT_BEGIN:
          if (marker.rooted) {
            // Uninteresting
            // yield result(marker, { className: "span" });
            marker = this.prev(marker);
            break;
          } // else fall through
        case MarkerType.INPUT_BEGIN:
        case MarkerType.STARTUP:
          yield result(marker, { source: marker });
          return;
        case MarkerType.DISPATCH:
        case MarkerType.REQUEST:
          marker = this.prev(marker);
          break;
        case MarkerType.REDISPATCH_BEGIN:
        case MarkerType.EXECUTE_BEGIN:
        case MarkerType.RESPONSE_BEGIN:
          let trail = this.backtrail(marker);
          yield result(marker, { trail });
          yield result(trail);
          marker = this.prev(trail);
          break;
        case MarkerType.ROOT_END:
        case MarkerType.LOOP_END:
          // Uninteresting, just skip
          marker = this.backtrail(marker);
          marker = this.prev(marker);
          break;
        case MarkerType.REDISPATCH_END:
        case MarkerType.EXECUTE_END:
        case MarkerType.RESPONSE_END:
        case MarkerType.LABEL_END:
        case MarkerType.INPUT_END:
          if (!skipNestedBlock) yield result(marker, { className: "span" });
          marker = this.backtrail(marker);
          if (!skipNestedBlock) yield result(marker, { className: "span" });
          marker = this.prev(marker);
          break;
        case MarkerType.ACCEPT:
          yield result(marker);
          marker = this.backtrail(marker);
          break;
        case MarkerType.LABEL_BEGIN:
          yield result(marker, { label: marker });
          if (marker === stop) {
            return;
          }
          marker = this.prev(marker);
          break;
        default:
          yield result(marker);
          marker = this.prev(marker);
          break;
      }
    };
  }
}
