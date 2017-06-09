var logan = null;

Array.prototype.last = function() {
  if (!this.length) {
    return undefined;
  }
  return this[this.length - 1];
};

(function() {

  function ensure(array, itemName, def = {}) {
    if (!(itemName in array)) {
      array[itemName] = def;
    }

    return array[itemName];
  }

  function isChildFile(file) {
    return file.name.match(/\.child-\d+(?:\.\d)?$/);
  }

  function isRotateFile(file) {
    return file.name.match(/\.\d$/);
  }

  function escapeRegexp(s) {
    return s.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
  }

  const printfToRegexpMap = {
    "%p": "([A-Fa-f0-9]+)",
    "%d": "([\\d]+)",
    "%u": "([\\d]+)",
    "%s": "([^\\s,]*)",
    "%x": "((?:0x)?[A-Fa-f0-9]+)",
  };

  function convertPrintfToRegexp(printf) {
    printf = escapeRegexp(printf);

    for (let source in printfToRegexpMap) {
      var target = printfToRegexpMap[source];
      printf = printf.replace(RegExp(source, "g"), target);
    }

    return new RegExp('^' + printf + '$');
  }

  function colorHash(salt, layover = 0xa0a0a0) {
    salt ^= salt >> 24;
    salt ^= salt >> 24;
    salt ^= salt >> 24;
    salt |= layover;
    salt &= 0xffffff;
    return salt.toString(16);
  }

  const FILE_SLICE = 512 * 1024;
  const LINE_MAIN_REGEXP = /^(\d+-\d+-\d+) (\d+:\d+:\d+\.\d+) \w+ - \[([^\]]+)\]: ([A-Z])\/(\w+) (.*)$/;
  const EPOCH_2015 = (new Date("2015-01-01")).valueOf();

  function Obj(ptr, logan) {
    this.id = logan.objects.length;
    this.props = { pointer: ptr, className: null };
    this.captures = [];
    this.shared = false;
    this.logan = logan;
    this.file = logan._proc.file;
    this.aliases = {};

    // This is used for placing the summary of the object (to generate
    // the unique ordered position, see UI.position.)
    // Otherwise there would be no other way than to use the first capture
    // that would lead to complicated duplications.
    this.placement = {
      time: this.logan._proc.timestamp,
      id: ++this.logan._proc.captureid,
    };

    this._references = {};
    this.maybeShared = function(capture) {
      if (this.shared) {
        return;
      }
      let className = capture.what.linkFrom.props.className;
      ensure(this._references, className, 0);
      if (++this._references[className] > 1) {
        this.shared = true;
        delete this["_references"];
      }
    };

    logan.objects.push(this);
  }

  Obj.prototype.create = function(className) {
    ensure(this.logan.searchProps, className, { pointer: true, state: true });

    if (this.props.className) {
      throw "Recreating object! (are you missing destructor rule for this class?)";
    }
    this.props.className = className;
    this.props.state = "created";
    return this.capture();
  };

  Obj.prototype.alias = function(alias) {
    this.aliases[alias] = true;
    this.logan._proc.objs[alias] = this;
    return this;
  };

  Obj.prototype.destroy = function() {
    delete this.logan._proc.objs[this.props.pointer];
    for (let alias in this.aliases) {
      delete this.logan._proc.objs[alias];
    }
    this.props.state = "released";
    delete this["_references"];
    return this.capture();
  };

  function Capture(obj, what) {
    this.id = ++obj.logan._proc.captureid;
    this.time = obj.logan._proc.timestamp;
    this.line = obj.logan._proc.linenumber;
    this.what = what;
  }

  Obj.prototype.capture = function(what) {
    what = what || this.logan._proc.line;
    let capture = Capture.prototype.isPrototypeOf(what) ? what : new Capture(this, what);
    this.captures.push(capture);
    return this;
  };

  Obj.prototype.follow = function(cond) {
    let capture = {
      obj: this,
    };

    if (typeof cond === "number") {
      capture.count = cond;
      capture.follow = (obj, line, proc) => {
        obj.capture(line);
        return --capture.count;
      };
    } else {
      capture.follow = cond;
    }

    this.logan._proc.thread._auto_follow = capture;
    return this;
  }

  Obj.prototype.prop = function(name, value, merge = false) {
    ensure(this.logan.searchProps, this.props.className)[name] = true;

    if (typeof merge === "funtion") {
      merge = merge(this);
    }

    if (value === undefined) {
      delete this.props[name];
    } else if (typeof value === "function") {
      this.props[name] = value(this.props[name] || 0);
    } else if (merge && this.props[name]) {
      this.props[name] += ("," + value);
    } else {
      this.props[name] = value;
    }
    return this.capture({ prop: name, value: value });
  };

  Obj.prototype.state = function(state, merge = false) {
    if (!state) {
      return this.props["state"];
    }
    return this.prop("state", state, merge);
  };

  Obj.prototype.stateIf = function(state, cond, merge = false) {
    if (!cond(this)) {
      return this;
    }
    return this.prop("state", state, merge);
  };

  Obj.prototype.links = function(that) {
    that = this.logan._proc.obj(that);
    let capture = new Capture(this, { linkFrom: this, linkTo: that });
    this.capture(capture);
    that.capture(capture).maybeShared(capture);
    return this;
  };

  Obj.prototype.mention = function(that) {
    if (parseInt(that, 16) === 0) {
      return this;
    }
    if (!(typeof that === "object") && !this.logan._proc.objs[that]) {
      return this.capture({ untracked: that });
    }
    that = logan._proc.obj(that);
    this.capture({ expose: that });
    return this;
  };

  Obj.prototype.guid = function(guid) {
    this.guid = guid;
    ensure(this.logan._proc.global, "guids")[guid] = this;
  };


  // export
  logan = {
    // processing state sub-object, passed to rule consumers
    // initialized in consumeFile(s)
    _proc: {
      obj: function(ptr) {
        if (Obj.prototype.isPrototypeOf(ptr)) {
          return ptr;
        }
        var obj = this.objs[ptr];
        if (!obj) {
          this.objs[ptr] = (obj = new Obj(ptr, logan));
        }
        return obj;
      },

      global_obj: function(guid) {
        return this.logan._proc.global.guids[guid] || new Obj(null, this.logan);
      }
    },

    _rules: {
      match: [],
      unmatch: [],
    },

    rule: function(exp, consumer) {
      this._rules.match.push({ regexp: convertPrintfToRegexp(exp), cond: null, consumer: consumer });
    },

    ruleIf: function(exp, condition, consumer) {
      this._rules.match.push({ regexp: convertPrintfToRegexp(exp), cond: condition, consumer: consumer });
    },

    plainIf: function(condition, consumer) {
      this._rules.unmatch.push({ cond: condition, consumer: consumer });
    },

    parse: function(line, regexp, consumer) {
      this.processRule(line, convertPrintfToRegexp(regexp), consumer);
    },


    _ui: {
      summary: {}, // map: className -> prop to display on the summary line
    },

    summaryProps: function(className, arrayOfProps) {
      this._ui.summary[className] = arrayOfProps;
    },

    // The rest is considered private

    filesToProcess: [],

    consumeFiles: function(UI, files) {
      if (this.reader) {
        this.reader.abort();
      }
      this.objects = [];
      this.searchProps = {};
      this._proc.global = {};
      this._proc.captureid = 0;

      this.filesToProcess = Array.from(files);
      this.searchAt = 0;

      this.consumeFile(UI);
    },

    consumeFile: function(UI, file = null, offset = 0, previousLine = "") {
      if (!file) {
        if (!this.filesToProcess.length) {
          this.reader = null;
          this.processEOS(UI);
          return;
        }

        // a new file to process
        file = this.filesToProcess.shift();
        this.eollength = 1;
        this.filename = file.name;
        this.fileoffset = 0;

        this._proc.threads = {};
        this._proc.objs = {};
        this._proc.file = file;
        this._proc.linenumber = 0;
        this._proc.child = isChildFile(file);
      }

      var blob = file.slice(offset, offset + FILE_SLICE);
      if (blob.size == 0) {
        if (previousLine) {
          this.consumeLine(UI, file, previousLine);
        }
        this.processEOF(UI);
        this._proc.file = null;
        this.consumeFile(UI);
        return;
      }

      this.reader = new FileReader();
      this.reader.onloadend = function(event) {
        if (event.target.readyState == FileReader.DONE) {
          if (offset === 0 && event.target.result.match('\r\n')) {
            this.eollength = 2;
          }

          var lines = event.target.result.split(/\r?\n/);

          // This simple code assumes that a single line can't be longer than FILE_SLICE
          previousLine += lines.shift();
          this.consumeLine(UI, file, previousLine);

          previousLine = lines.pop();
          for (let line of lines) {
            this.consumeLine(UI, file, line);
          }

          this.consumeFile(UI, file, offset + FILE_SLICE, previousLine);
        }
      }.bind(this);

      this.reader.onerror = function(event) {
        this.reader = null;
        alert(event);
      }.bind(this);

      this.reader.readAsBinaryString(blob);
    },

    consumeLine: function(UI, file, line) {
      ++this._proc.linenumber;
      this._proc.lineBinaryOffset = this.fileoffset;
      this.fileoffset += line.length + this.eollength;
      UI.loadProgress(this.fileoffset, file.size);

      var main = line.match(LINE_MAIN_REGEXP);
      if (!main) {
        this.processLine([this._rules.unmatch], file, line);
        return;
      }

      var [all, date, time, thread, level, module, text] = main;
      this._proc.timestamp = new Date(date + "T" + time + "Z");
      this._proc.thread = ensure(this._proc.threads, file + "|" + thread, { name: thread });

      this.processLine([this._rules.match, this._rules.unmatch], file, text);
    },

    processLine: function(rules, file, line) {
      this._proc.thread._auto_follow = null;
      for (let ruleSet of rules) {
        if (this.processLineByRules(ruleSet, file, line)) {
          this._proc.thread._auto_capture = this._proc.thread._auto_follow;
          return true;
        }
      }

      let autoCapture = this._proc.thread._auto_capture;
      if (!autoCapture) {
        return false;
      }
      if (!autoCapture.follow(autoCapture.obj, line, this._proc)) {
        this._proc.thread._auto_capture = null;
      }
      return true;
    },

    processLineByRules: function(ruleSet, file, line) {
      this._proc.line = line;
      for (let rule of ruleSet) { // optmize this!!!
        try {
          if (rule.cond && !rule.cond(this._proc)) {
            continue;
          }
        } catch (e) {
          alert("\"" + e.message + "\" while processing rule condition at " + e.fileName + ":" + e.lineNumber +
            "\n\nprocessed text: " + line + " at " + file.name + ":" + this._proc.linenumber +
            "\n\nfile loading stopped");
          throw e;
        }

        if (!rule.regexp) {
          if (!rule.cond) {
            throw "INTERNAL ERROR: No regexp and no cond on a rule";
          }

          rule.consumer.call(this._proc, line);
          return true;
        }

        if (!this.processRule(line, rule.regexp, rule.consumer)) {
          continue;
        }
        return true;
      }

      return false;
    },

    processRule: function(line, regexp, consumer) {
      let match = line.match(regexp);
      if (!match) {
        return false;
      }

      consumer.apply(this._proc, match.slice(1));
      return true;
    },

    processEOF: function(UI) {
    },

    processEOS: function(UI) {
      UI.loadProgress(0);
      UI.fillClassNames(this.searchProps);
      UI.fillSearchBy();
    },

    search: function(UI, className, propName, matchValue, match) {
      var matchFunc;
      switch (match) {
        case "exact": {
          matchFunc = function(prop) { return matchValue === prop; }
          break;
        }
        case "contains": {
          let contains = new RegExp(escapeRegexp(matchValue), "g");
          matchFunc = function(prop) { return prop.match(contains); }
          break;
        }
        case "!contains": {
          let ncontains = new RegExp(escapeRegexp(matchValue), "g");
          matchFunc = function(prop) { return !prop.match(ncontains); }
          break;
        }
        case "regexp": {
          let regexp = new RegExp(matchValue, "g");
          matchFunc = function(prop) { return prop.match(regexp); }
          break;
        }
        case "!regexp": {
          let nregexp = new RegExp(matchValue, "g");
          matchFunc = function(prop) { return !prop.match(nregexp); }
          break;
        }
        case "any":
          matchFunc = () => true;
          break;
        default:
          throw "Unexpected match operator";
      }

      UI.captureLimitApplied = this.searchAt;

      for (let obj of this.objects) {
        if (className != obj.props.className) {
          continue;
        }
        if (this.searchAt && obj.captures[0].id > this.searchAt) {
          continue;
        }
        if (this.searchAt && obj.captures.last().id >= this.searchAt) {
          // The object lives around the cutting point, find the prop value
          var prop = "";
          let capture = obj.captures.find(capture => {
            if (capture.id > this.searchAt) {
              return true;
            }
            if (typeof capture.what === "object") {
              if (capture.what.prop) console.log(capture.what.prop + "=" + capture.what.value);
              if (capture.what.prop == propName) {
                prop = capture.what.value;
              }
            }
            return false;
          }, this);
        } else {
          var prop = obj.props[propName] || "";
        }
        if (!matchFunc(prop)) {
          continue;
        }
        UI.addResult(obj).addClass("result");
      }
    },
  }; // logan impl



  var UI =
    {
      expandedElement: null,
      display: {},
      dynamicStyle: {},
      activeRevealeres: 0,

      loadProgress: function(prog, max = 1) {
        if (prog) {
          $("#load_progress").show().css("width", (prog * 100.0 / max) + "%");
        } else {
          $("#load_progress").hide();
        }
      },

      setInitialView: function() {
        $("#file_load_section").removeClass().addClass("section").show();
        $("#search_section").hide();
      },

      setSearchView: function(reset) {
        $("#file_load_section").removeClass().addClass("topbar").show();
        $("#search_section").show();
        if (reset) {
          $("#search_className").empty();
          $("#search_By").empty();
          $("#results_section").empty();
          $("#uptoline_reset").click();
        }
      },

      setResultsView: function(reset) {
        $("#search_section").removeClass().addClass("topbar").show();
        $("#results_section").show();
        $("#search_By").change();
        if (reset) {
          $("#results_section").empty();
          this.display = {};
          $("#dynamic_style").empty();
          this.dynamicStyle = {};
          this.activeRevealeres = 0;
          this.inFocus = null;
        }
      },

      fillClassNames: function(classNames) {
        let select = $("#search_className");
        for (let className in classNames) {
          if (className !== "null") {
            select.append($("<option>").attr("value", className).text(className));
          }
        }
      },

      fillSearchBy: function(props) {
        if (!props) {
          props = logan.searchProps[$("#search_className").val()] || {};
        }
        let select = $("#search_By");
        select.empty();
        for (let prop in props) {
          select.append($("<option>").attr("value", prop).text(prop));
        }
      },

      objHighlighter: function(obj, source = null, set = false) {
        source = source || obj;

        let style = "div.log_line.obj-" + obj.id + " { background-color: #" + colorHash(
          source.id * 0x12345 + parseInt(source.props.pointer, 16) * 0xf0f0f0
        ) + "}";

        return function(event) {
          if (set) {
            this.changeDynamicStyle("obj-" + obj.id, style);
          } else {
            this.toggleDynamicStyle("obj-" + obj.id, style);
          }
        }.bind(this);
      },

      summaryProps: function(obj) {
        var custom = logan._ui.summary[obj.props.className] || [];
        return ["className", "pointer"].concat(custom);
      },

      summary: function(obj) {
        var props = this.summaryProps(obj);
        var summary = obj.placement.time.toISOString().replace(/[TZ]/g, " ").trim();
        for (let prop of props) {
          if (summary) summary += " \u2502 ";
          summary += obj.props[prop] || "-";
        }
        return summary;
      },

      quick: function(obj) {
        return (obj.props.className || "(" + obj.id + ")") + " @" + obj.props.pointer;
      },

      closeExpansion: function(newElement = null) {
        if (this.expandedElement) {
          this.expandedElement.remove();
        }
        this.expandedElement = newElement;
      },

      // this method is mostly meaningless, but leaving it in case
      // I invent something smart here...
      // the plan to interleave child processes is to process lines
      // as put one by one sorted by timestamp (naive)
      position: function(capture) {
        if (!capture) {
          return 0;
        }
        return capture.id;
      },

      place: function(capture, element) {
        if (this.captureLimitApplied && capture.id > this.captureLimitApplied) {
          element.addClass("past_capture_limit");
        }

        let position = this.position(capture);

        if (this.display[position]) {
          // When a link revealer is turned on, it is readded (the object has the same capture)
          // Removing it would leave an element that is unchecked.
          this.display[position].__refs++;
          // XXX: there is no way to remove the added classes when the line is dereferenced
          //      but still left in the view
          this.display[position].addClass(element.attr("class"));
          return this.display[position];
        }

        element.attr("capture", capture.id);

        let keys = Object.keys(this.display);
        keys.sort((a, b) => parseInt(a) - parseInt(b));
        let following = keys.find((a) => parseInt(a) > parseInt(position));

        if (following === undefined) { // can be last
          $("#results_section").append(element);
        } else { // has to be placed before
          element.insertBefore(this.display[following]);
        }

        element.__refs = 1;
        return (this.display[position] = element);
      },

      addRevealer: function(obj, builder, capture = null, includeSummary = false, top = null) {
        top = top || obj;
        let element = $("<div>")
          .addClass("log_line obj-" + obj.id)
          .addClass(() => includeSummary ? "" : "summary")
          .append($("<input type='checkbox'>")
            .on("change", function(event) {
              this.onExpansion(obj, element, event.target.checked);
              if (event.target.checked) {
                this.objHighlighter(obj, top, true)();
                if (includeSummary && obj.props.className) {
                  this.addSummary(obj);
                }
                element.addClass("checked");
                for (let capture of obj.captures) {
                  this.addCapture(obj, capture, top);
                }
              } else {
                if (includeSummary && obj.props.className) {
                  this.removeLine(this.position(obj.placement));
                }
                element.removeClass("checked");
                for (let capture of obj.captures) {
                  this.removeLine(this.position(capture));
                }
              }
            }.bind(this))
          );

        builder(element);
        return this.place(capture || obj.placement, element);
      },

      addResult: function(obj) {
        return this.addRevealer(obj, (element) => {
          element
            .addClass(() => (obj.references > 1) ? "shared" : "")
            .append($("<span>")
              .text(this.summary(obj)))
            .click(this.objHighlighter(obj));
        });
      },

      addSummary: function(obj, top) {
        let element = $("<div>")
          .addClass("log_line expanded summary obj-" + obj.id)
          .addClass(() => (obj.references > 1) ? "shared" : "")
          .append($("<span>")
            .text(this.summary(obj)))
          .click(this.objHighlighter(obj, top));

        return this.place(obj.placement, element);
      },

      addCapture: function(obj, capture, top) {
        if (!capture.what) {
          return;
        }

        if (typeof capture.what == "object") {
          let linkFrom = capture.what.linkFrom;
          let linkTo = capture.what.linkTo;
          if (linkTo && linkFrom) {
            let target = obj === linkTo ? linkFrom : linkTo;
            let highlight = top == linkTo ? top : (obj === linkFrom ? top : linkFrom);
            return this.addRevealer(target, (element) => {
              element
                .addClass("expanded revealer obj-" + obj.id)
                .append($("<span>")
                  .text(this.quick(linkFrom) + " --> " + this.quick(linkTo)))
                .click(this.objHighlighter(target, highlight))
            }, capture, true, highlight);
          }

          let expose = capture.what.expose;
          if (expose) {
            return this.addRevealer(expose, (element) => {
              element
                .addClass("expanded revealer obj-" + obj.id)
                .append($("<span>").text("   " + this.quick(expose)))
                .click(this.objHighlighter(expose))
            }, capture, true);
          }

          let untracked = capture.what.untracked;
          if (untracked) {
            let element = $("<div>")
              .addClass("log_line expanded revealer obj-" + obj.id)
              .append($("<pre>").text("<untracked> @" + untracked))
              .click(this.objHighlighter(obj));

            return this.place(capture, element);
          }

          // An empty or unknown capture is just ignored.
          return;
        }

        let time = capture.time.toISOString().replace(/[TZ]/g, " ").trim();
        let line = time + " \u2502 " + capture.what;
        let element = $("<div>")
          .addClass("log_line expanded obj-" + obj.id)
          .addClass(() => obj.shared ? "shared" : "")
          .append($("<pre>").text(line))
          .click(this.objHighlighter(obj));

        return this.place(capture, element);
      },

      removeLine: function(position) {
        if (this.display[position] && --this.display[position].__refs === 0) {
          this.display[position].remove();
          delete this.display[position];
        }
      },

      onExpansion: function(obj, element, revealed) {
        if (this.inFocus) {
          this.inFocus.removeClass("focused");
        }
        this.inFocus = element;
        this.inFocus.addClass("focused");

        let before = this.activeRevealeres;
        this.activeRevealeres += revealed ? 1 : -1;
        if (!before && this.activeRevealeres) {
          this.changeDynamicStyle("dimm-non-expanded", "div.log_line:not(.expanded) { color: #aaa; }");
        } else if (before && !this.activeRevealeres) {
          this.changeDynamicStyle("dimm-non-expanded", null);
          // Workaround when the "expanded" class is set on an existing result
          // by revealing from bottom.
          $("#results_section > div.expanded").removeClass("expanded");
        }
      },

      changeDynamicStyle: function(id, style) {
        if (style) {
          this.dynamicStyle[id] = style;
        } else {
          delete this.dynamicStyle[id];
        }

        let content = "";
        for (id in this.dynamicStyle) {
          content += this.dynamicStyle[id];
        }

        $("#dynamic_style").html(content);
      },

      toggleDynamicStyle: function(id, style) {
        if (this.dynamicStyle[id] == style) {
          this.changeDynamicStyle(id, null);
        } else {
          this.changeDynamicStyle(id, style);
        }
      }
    }; // UI



  $(() => {
    $("#files").on("change", (event) => {
      UI.setSearchView(true);
      logan.consumeFiles(UI, event.target.files);
    });

    $("#search_By").on("change", (event) => {
      ($("#results_section").is(":visible"))
        ? $("#subsec_UpToLine").show() : $("#subsec_UpToLine").hide();
    }).change();

    $("#search_Matching").on("change", (event) => {
      (event.target.value == "any")
        ? $("#search_PropValue").hide() : $("#search_PropValue").show();
    }).change();

    $("#search_className").on("change", (event) => {
      let props = logan.searchProps[event.target.value] || {};
      UI.fillSearchBy(props);
    });

    let search = function(reset, event) {
      if (logan.reader) {
        return;
      }
      UI.setResultsView(reset);
      logan.search(UI,
        $("#search_className").val(),
        $("#search_By").val(),
        $("#search_PropValue").val(),
        $("#search_Matching").val());
    }
    $("#search_button").click(search.bind(this, true));
    $("#search_button_add").click(search.bind(this, false));

    let linePicker = function(event) {
      // Maybe called manually to reset
      if (event) {
        logan.searchAt = parseInt(this.getAttribute("capture"));

        $("#search_UpToCapture").val(this.textContent);
        event.stopPropagation();
      }

      $("#results_section > div.log_line").each((i, element) => {
        element.removeEventListener("click", linePicker, true);
      });

      $("#uptoline_pick").attr("disabled", null);
      UI.changeDynamicStyle("linepick");
    }
    $("#uptoline_pick").click((event) => {
      $("#results_section > div.log_line").each((i, element) => {
        element.addEventListener("click", linePicker, true);
      });
      $("#uptoline_pick").attr("disabled", "disabled");
      UI.changeDynamicStyle("linepick", "div.log_line:hover { cursor: alias !important; background-color: black !important; color: white !important }");
    });
    $("#uptoline_reset").click((event) => {
      logan.searchAt = 0;
      $("#search_UpToCapture").val("");
      linePicker();
    });

    $(window).on("keypress", (event) => {
      if (event.keyCode == 27) {
        UI.closeExpansion();
      }
      linePicker();
    });

    var files = $("#files").get()[0].files;
    if (files.length) {
      UI.setSearchView(true);
      logan.consumeFiles(UI, files);
    } else {
      UI.setInitialView();
    }
  });

})();
