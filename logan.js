const LOG = false ? (output) => { console.log(output) } : () => { };

var logan = null;

Array.prototype.last = function() {
  if (!this.length) {
    return undefined;
  }
  return this[this.length - 1];
};

Array.prototype.remove = function(finder) {
  let index = this.findIndex(finder);
  if (index > -1) {
    this.splice(index, 1);
  }
};

Array.prototype.after = function(element, finder) {
  let index = this.findIndex(finder);
  if (index > -1) {
    this.splice(index, 0, element);
  } else {
    this.push(element);
  }
};

function ensure(array, itemName, def = {}) {
  if (!(itemName in array)) {
    array[itemName] = (typeof def === "function") ? def() : def;
  }

  return array[itemName];
}

(function() {

  const FILE_SLICE = 20 * 1024 * 1024;
  const EPOCH_2015 = (new Date("2015-01-01")).valueOf();
  const USE_RULES_TREE_OPTIMIZATION = true;

  let IF_RULE_INDEXER = 0;

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
    "%p": "((?:0x)?[A-Fa-f0-9]+)",
    "%d": "([\\d]+)",
    "%u": "([\\d]+)",
    "%s": "((?:,?[^\\s])*)",
    "%[xX]": "((?:0x)?[A-Fa-f0-9]+)",
    "%\\\\\\*\\\\\\$": "(.*$)",
  };

  function convertPrintfToRegexp(printf) {
    printf = escapeRegexp(printf);

    for (let source in printfToRegexpMap) {
      var target = printfToRegexpMap[source];
      printf = printf.replace(RegExp(source, "g"), target);
    }

    return new RegExp('^' + printf + '$');
  }

  function ruleMappingGrade1(input) {
    let splitter = /(\W)/;
    let grade1 = input.split(splitter, 1)[0];
    if (!grade1) {
      grade1 = input.split(splitter, 3).join('');
    }
    return grade1;
  }

  function ruleMappingGrade2(input) {
    let grade1 = ruleMappingGrade1(input);
    let grade2 = input.substring(grade1.length);
    return { grade1, grade2 };
  }

  const GREP_REGEXP = new RegExp("((?:0x)?[A-Fa-f0-9]{4,})", "g");
  const NULLPTR_REGEXP = /^0+$/;

  function Schema(namespace, lineRegexp, linePreparer) {
    this.namespace = namespace;
    this.lineRegexp = lineRegexp;
    this.linePreparer = linePreparer;
    this.modules = {};
    this.unmatch = [];
    this.ui = {
      summary: {}, // map: className -> prop to display on the summary line
    };

    this._finalize = function() {
      if (USE_RULES_TREE_OPTIMIZATION) {
        for (let module of Object.values(this.modules)) {
          for (let grade1 in module.rules_tree) {
            module.rules_tree[grade1] = Object.values(module.rules_tree[grade1]);
          }
        }
      }

      // This is grep() handler, has to be added as last because its condition handler
      // never returns true making following conditional rules process the line as well.
      this.plainIf(function(state) {
        let pointers = state.line.match(GREP_REGEXP);
        if (pointers) {
          for (let ptr of pointers) {
            let obj = state.objs[ptr];
            if (obj && obj._grep) {
              obj.capture();
            }
          }
        }
      }, () => { throw "grep() internal consumer should never be called"; });
    }
  }

  Schema.prototype.module = function(name, builder) {
    builder(ensure(this.modules, name, new Module(name)));
  }

  Schema.prototype.plainIf = function(condition, consumer = function(ptr) { this.obj(ptr).capture(); }) {
    let rule = { cond: condition, consumer: consumer, id: ++IF_RULE_INDEXER };
    this.unmatch.push(rule);
    return rule;
  };

  Schema.prototype.ruleIf = function(exp, condition, consumer = function(ptr) { this.obj(ptr).capture(); }) {
    let rule = { regexp: convertPrintfToRegexp(exp), cond: condition, consumer: consumer, id: ++IF_RULE_INDEXER };
    this.unmatch.push(rule);
    return rule;
  };

  Schema.prototype.removeIf = function(rule) {
    this.unmatch.remove(item => item.id === rule.id);
  }

  Schema.prototype.summaryProps = function(className, arrayOfProps) {
    this.ui.summary[className] = arrayOfProps;
  };


  function Module(name) {
    this.name = name;
    this.rules_flat = [];
    this.rules_tree = {};

    this.set_rule = function(rule, input) {
      if (USE_RULES_TREE_OPTIMIZATION) {
        let mapping = ruleMappingGrade2(input);
        let grade2 = ensure(this.rules_tree, mapping.grade1, {});
        grade2[mapping.grade2] = rule;
      } else {
        this.rules_flat.push(rule);
      }
    };

    this.get_rules = function(input) {
      if (USE_RULES_TREE_OPTIMIZATION) {
        // logan.init() converts this to array.
        return this.rules_tree[ruleMappingGrade1(input)] || [];
      }
      return this.rules_flat;
    };
  }

  Module.prototype.rule = function(exp, consumer = function(ptr) { this.obj(ptr).capture(); }) {
    this.set_rule({ regexp: convertPrintfToRegexp(exp), cond: null, consumer: consumer }, exp);
  };


  function Obj(ptr) {
    this.id = logan.objects.length;
    this.props = { pointer: ptr, className: null };
    this.captures = [];
    this.shared = false;
    this.file = logan._proc.file;
    this.aliases = {};
    this._grep = false;

    // This is used for placing the summary of the object (to generate
    // the unique ordered position, see UI.position.)
    // Otherwise there would be no other way than to use the first capture
    // that would lead to complicated duplications.
    this.placement = {
      time: logan._proc.timestamp,
      id: ++logan._proc.captureid,
    };

    this._references = {};
    this._maybeShared = function(capture) {
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
    ensure(logan.searchProps, className, { pointer: true, state: true });

    if (this.props.className) {
      throw "Recreating object! (are you missing destructor rule for this class?)";
    }
    this.props.className = className;
    this.prop("state", "created");
    return this.capture();
  };

  Obj.prototype.alias = function(alias) {
    this.aliases[alias] = true;
    logan._proc.objs[alias] = this;
    return this;
  };

  Obj.prototype.destroy = function() {
    delete logan._proc.objs[this.props.pointer];
    for (let alias in this.aliases) {
      delete logan._proc.objs[alias];
    }
    this.prop("state", "released");
    delete this["_references"];

    return this.capture();
  };

  function Capture(what) {
    this.id = ++logan._proc.captureid;
    this.time = logan._proc.timestamp;
    this.line = logan._proc.linenumber;
    this.thread = logan._proc.thread.name;
    this.what = what;
  }

  Obj.prototype.capture = function(what) {
    what = what || logan._proc.line;
    let capture = Capture.prototype.isPrototypeOf(what) ? what : new Capture(what);
    this.captures.push(capture);
    return this;
  };

  Obj.prototype.grep = function() {
    this._grep = true;
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

    logan._proc.thread._follow = capture;
    return this;
  }

  Obj.prototype.prop = function(name, value, merge = false) {
    ensure(logan.searchProps, this.props.className)[name] = true;

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
    return this.capture({ prop: name, value: this.props[name] });
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

  Obj.prototype.link = function(that) {
    that = logan._proc.obj(that);
    let capture = new Capture({ linkFrom: this, linkTo: that });
    this.capture(capture);
    that.capture(capture)._maybeShared(capture);
    return this;
  };

  Obj.prototype.mention = function(that) {
    if (typeof that === "string" && that.match(NULLPTR_REGEXP)) {
      return this;
    }
    that = logan._proc.obj(that);
    this.capture({ expose: that });
    return this;
  };

  Obj.prototype.guid = function(guid) {
    this.guid = guid;
    ensure(logan._proc.global, "guids")[guid] = this;
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
          this.objs[ptr] = (obj = new Obj(ptr));
        }
        return obj;
      },

      global_obj: function(guid) {
        return logan._proc.global.guids[guid] || new Obj(null);
      }
    },

    _schemes: {},
    _schema: null,

    schema: function(name, lineRegexp, linePreparer, builder) {
      this._schema = ensure(this._schemes, name, new Schema(name, lineRegexp, linePreparer));
      builder(this._schema);
    },

    activeSchema: function(name) {
      this._schema = this._schemes[name];
    },

    parse: function(line, printf, consumer, failedConsumer) {
      if (!this.processRule(line, convertPrintfToRegexp(printf), consumer) && failedConsumer) {
        failedConsumer(line);
      }
    },


    // The rest is considered private

    _filesToProcess: [],

    init: function() {
      for (let schema of Object.values(this._schemes)) {
        schema._finalize();
      }
    },

    consumeFiles: function(UI, files) {
      if (this.reader) {
        this.reader.abort();
      }
      this.objects = [];
      this.searchProps = {};
      this._proc.global = {};
      this._proc.captureid = 0;

      this._filesToProcess = Array.from(files);
      this.seekId = 0;

      this.consumeFile(UI);
    },

    consumeFile: function(UI, file = null, offset = 0, previousLine = "") {
      if (!file) {
        if (!this._filesToProcess.length) {
          this.reader = null;
          this.processEOS(UI);
          return;
        }

        // a new file to process
        this.__metric_process_start = new Date();
        this.__metric_rules_match_count = 0;

        file = this._filesToProcess.shift();
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

          UI.loadProgress(this.fileoffset, file.size);

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
      if (this.consumeLineByRules(UI, file, line)) {
        return;
      }

      // Note that this._proc.line is set to |text| from linePreparer in processLine()
      // which has definitely been called for this consumed line at this point.
      let autoCapture = this._proc.thread._auto_capture;
      if (autoCapture && !autoCapture.follow(autoCapture.obj, this._proc.line, this._proc)) {
        this._proc.thread._auto_capture = null;
      }      
    },

    consumeLineByRules: function(UI, file, line) {
      ++this._proc.linenumber;
      this._proc.lineBinaryOffset = this.fileoffset;
      this.fileoffset += line.length + this.eollength;

      let match = line.match(this._schema.lineRegexp);
      if (!match) {
        return this.processLine(this._schema.unmatch, file, line);
      }

      let [module, text] = this._schema.linePreparer.apply(null, [this._proc].concat(match));

      module = this._schema.modules[module];
      if (module && this.processLine(module.get_rules(text), file, text)) {
        return true;
      }
      if (this.processLine(this._schema.unmatch, file, text)) {
        return true;
      }

      return false;      
    },

    processLine: function(rules, file, line) {
      this._proc.thread._follow = null;

      if (this.processLineByRules(rules, file, line)) {
        this._proc.thread._auto_capture = this._proc.thread._follow;
        return true;
      }

      return false;
    },

    processLineByRules: function(rules, file, line) {
      this._proc.line = line;
      for (let rule of rules) {
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
      this.__metric_rules_match_count++;

      let match = line.match(regexp);
      if (!match) {
        return false;
      }

      consumer.apply(this._proc, match.slice(1));
      return true;
    },

    processEOF: function(UI) {
      let fileProcessTime = (new Date()).getTime() - this.__metric_process_start.getTime();
      LOG("consumed file in " + (fileProcessTime / 1000) + "s");
      LOG("rules matched " + Math.floor(this.__metric_rules_match_count / 1000) + "k");
      LOG("efficiency " + Math.floor((this.fileoffset >> 10) / (fileProcessTime / 1000)) + " kbytes/sec");
    },

    processEOS: function(UI) {
      UI.loadProgress(0);
      UI.fillClassNames(this.searchProps);
      UI.fillSearchBy();
    },

    search: function(UI, className, propName, matchValue, match) {
      var matchFunc;
      switch (match) {
        case "==": {
          matchFunc = function(prop) { return matchValue === prop.toString(); }
          break;
        }
        case "contains": {
          let contains = new RegExp(escapeRegexp(matchValue), "g");
          matchFunc = function(prop) { return prop.toString().match(contains); }
          break;
        }
        case "!contains": {
          let ncontains = new RegExp(escapeRegexp(matchValue), "g");
          matchFunc = function(prop) { return !prop.toString().match(ncontains); }
          break;
        }
        case "rx": {
          let regexp = new RegExp(matchValue, "g");
          matchFunc = function(prop) { return prop.toString().match(regexp); }
          break;
        }
        case "!rx": {
          let nregexp = new RegExp(matchValue, "g");
          matchFunc = function(prop) { return !prop.toString().match(nregexp); }
          break;
        }
        case "*":
          matchFunc = () => true;
          break;
        default:
          throw "Unexpected match operator";
      }

      for (let obj of this.objects) {
        if (className != obj.props.className) {
          continue;
        }
        if (this.seekId && obj.captures[0].id > this.seekId) {
          continue;
        }
        if (this.seekId && obj.captures.last().id >= this.seekId) {
          // The object lives around the cutting point, find the prop value
          var prop = "";
          let capture = obj.captures.find(capture => {
            if (capture.id > this.seekId) {
              return true;
            }
            if (typeof capture.what === "object" &&
                capture.what.prop == propName) {
              prop = capture.what.value;
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

})();
