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
    this.splice(index + 1, 0, element);
  } else {
    this.push(element);
  }
};

Array.prototype.before = function(element, finder) {
  let index = this.findIndex(finder);
  if (index > -1) {
    this.splice(index, 0, element);
  } else {
    this.unshift(element);
  }
};

function ensure(array, itemName, def = {}) {
  if (!(itemName in array)) {
    array[itemName] = (typeof def === "function") ? def() : def;
  }

  return array[itemName];
}

function Bag(def) {
  for (let prop in def) {
    this[prop] = def[prop];
  }
}

Bag.prototype.on = function(prop, handler) {
  if (!this[prop]) {
    return;
  }
  return (this[prop] = handler(this[prop]));
};

const GREP_REGEXP = new RegExp("((?:0x)?[A-Fa-f0-9]{4,})", "g");

(function() {

  const FILE_SLICE = 5 * 1024 * 1024;
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
    return s.replace(/\n$/, "").replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
  }

  const printfToRegexpMap = {
    "%p": "((?:(?:0x)?[A-Fa-f0-9]+)|(?:\\(null\\))|(?:\\(nil\\)))",
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
    if (grade1 && grade1.match(/%/)) {
      // grade1 contains a dynamic part, use the whole input as mapping
      // this is specially handled in module.set_rule
      return input;
    }
    return grade1;
  }

  function ruleMappingGrade2(input) {
    let grade1 = ruleMappingGrade1(input);
    let grade2 = input.substring(grade1.length);
    return { grade1, grade2 };
  }

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
          if (pointers.length === 1 && state.line.trim() == pointers[0]) {
            // It doesn't make sense to include lines only containing the pointer.
            // TODO the condition here should be made even smarter to filter out
            // more of just useless lines.
            return;
          }
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
        if (mapping.grade2) {
          let grade2 = ensure(this.rules_tree, mapping.grade1, {});
          grade2[mapping.grade2] = rule;
        } else {
          // all one-grade rules go alone, to allow dynamic parts to be at the begining of rules
          this.rules_flat.push(rule);
        }
      } else {
        this.rules_flat.push(rule);
      }
    };

    this.get_rules = function(input) {
      if (USE_RULES_TREE_OPTIMIZATION) {
        // logan.init() converts rules_tree to array.
        return (this.rules_tree[ruleMappingGrade1(input)] || []).concat(this.rules_flat);
      }
      return this.rules_flat;
    };
  }

  Module.prototype.rule = function(exp, consumer = function(ptr) { this.obj(ptr).capture(); }) {
    this.set_rule({ regexp: convertPrintfToRegexp(exp), cond: null, consumer: consumer }, exp);
  };


  function Obj(ptr) {
    this.id = logan.objects.length;
    this.props = new Bag({ pointer: ptr, className: null });
    this.captures = [];
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

    logan.objects.push(this);
  }

  Obj.prototype.on = Bag.prototype.on;

  Obj.prototype.create = function(className) {
    if (this.props.className) {
      console.warn(logan.exceptionParse("object already exists, recreting automatically from scratch"));
      this.destroy();
      return logan._proc.obj(this.__most_recent_accessor).create(className);
    }

    ensure(logan.searchProps, className, { pointer: true, state: true });

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

  Obj.prototype.follow = function(cond, consumer, error = () => true) {
    let capture = {
      obj: this,
    };

    if (typeof cond === "number") {
      capture.count = cond;
      capture.follow = (obj, line, proc) => {
        obj.capture(line);
        return --capture.count;
      };
    } else if (typeof cond === "string") {
      capture.follow = (obj, line, proc) => {
        return logan.parse(line, cond, function() {
          return consumer.apply(this, [obj].concat(Array.from(arguments)).concat([this]));
        }, (line) => error(obj, line));
      };
    } else if (typeof cond === "function") {
      capture.follow = cond;
    } else {
      throw "Internal error: follow 'cond' argument unexpected type '" + typeof cond + "'";
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

  Obj.prototype.propIf = function(name, value, cond, merge) {
    if (!cond(this)) {
      return this;
    }
    return this.prop(name, value, merge);
  };

  Obj.prototype.propIfNull = function(name, value) {
    if (name in this.props) {
      return this;
    }
    return this.prop(name, value);
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
    that.capture(capture);
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

  Obj.prototype.class = function(className) {
    if (this.props.className) {
      // Already created
      return this;
    }
    return this.create(className).state("partial").prop("missing-constructor", true);
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
        obj.__most_recent_accessor = ptr;
        return obj;
      },

      objIf: function(ptr) {
        if (Obj.prototype.isPrototypeOf(ptr)) {
          return ptr;
        }
        var obj = this.objs[ptr];
        if (!obj) {
          return new Obj(ptr); // temporary, but never put to the tracking array
        }
        obj.__most_recent_accessor = ptr;
        return obj;
      },

      duration: function(timestamp) {
        if (!timestamp) {
          return undefined;
        }
        return this.timestamp.getTime() - timestamp.getTime();
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
      return this.processRule(line, convertPrintfToRegexp(printf), consumer) ||
        (failedConsumer && failedConsumer.call(this._proc, line));
    },


    // The rest is considered private

    exceptionParse: function(exception) {
      if (typeof exception === "object") {
        exception = "'" + exception.message + "' at " + exception.fileName + ":" + exception.lineNumber
      }
      exception += "\nwhile processing '" + this._proc.line +
                   "'\nat " + this._proc.file.name + ":" + this._proc.linenumber;
      return exception;
    },

    _filesToProcess: [],

    init: function() {
      for (let schema of Object.values(this._schemes)) {
        schema._finalize();
      }
    },

    consumeURL: function(UI, url) {
      if (this.reader) {
        this.reader.abort();
      }
      this.objects = [];
      this.searchProps = {};
      this._proc.global = {};
      this._proc.captureid = 0;

      this.seekId = 0;

      fetch(url).then(function(response) {
        return response.blob();
      }).then(function(blob) {
        this._filesToProcess = [blob];
        blob.name = "_net_"
        this.consumeFile(UI);
      }.bind(this));
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

        UI.title(file.name);
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
        if (event.target.readyState == FileReader.DONE && event.target.result) {
          if (offset === 0 && event.target.result.match('\r\n')) {
            this.eollength = 2;
          }

          var lines = event.target.result.split(/[\r\n]+/);

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
        this.reader.abort();
        this.reader = null;
        throw event.type;
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
      let conditionResult;
      for (let rule of rules) {
        try {
          if (rule.cond) {
            conditionResult = rule.cond(this._proc);
            if (!conditionResult) {
              continue;
            }
          }
        } catch (exception) {
          throw this.exceptionParse(exception);
        }

        if (!rule.regexp) {
          if (!rule.cond) {
            throw this.exceptionParse("INTERNAL ERROR: No regexp and no cond on a rule");
          }

          try {
            rule.consumer.call(this._proc, line, conditionResult);
          } catch (exception) {
            throw this.exceptionParse(exception);
          }
          return true;
        }

        if (!this.processRule(line, rule.regexp, function() {
              rule.consumer.apply(this, Array.from(arguments).concat(conditionResult));
            })) {
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

      try {
        consumer.apply(this._proc, match.slice(1));
      } catch (exception) {
        throw this.exceptionParse(exception);
      }
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

    search: function(UI, className, propName, matchValue, match, seekId, coloring) {
      var matchFunc;
      propToString = (prop) => (prop === undefined ? "" : prop.toString());
      switch (match) {
        case "==": {
          matchFunc = prop => matchValue == propToString(prop);
          break;
        }
        case "!!": {
          matchFunc = prop => prop !== undefined;
          break;
        }
        case "!": {
          matchFunc = prop => prop === undefined;
          break;
        }
        case ">": {
          matchFunc = prop => prop > matchValue;
          break;
        }
        case "<": {
          matchFunc = prop => prop < matchValue;
          break;
        }
        case "contains": {
          let contains = new RegExp(escapeRegexp(matchValue), "g");
          matchFunc = prop => propToString(prop).match(contains);
          break;
        }
        case "!contains": {
          let ncontains = new RegExp(escapeRegexp(matchValue), "g");
          matchFunc = prop => !propToString(prop).match(ncontains);
          break;
        }
        case "rx": {
          let regexp = new RegExp(matchValue, "g");
          matchFunc = prop => propToString(prop).match(regexp);
          break;
        }
        case "!rx": {
          let nregexp = new RegExp(matchValue, "g");
          matchFunc = prop => !propToString(prop).match(nregexp);
          break;
        }
        default:
          throw "Unexpected match operator";
      }

      for (let obj of this.objects) {
        if (className != obj.props.className) {
          continue;
        }
        if (seekId && obj.captures[0].id > seekId) {
          continue;
        }
        if (seekId && obj.captures.last().id >= seekId) {
          // The object lives around the cutting point, find the prop value
          var prop = "";
          let capture = obj.captures.find(capture => {
            if (capture.id > seekId) {
              return true;
            }
            if (typeof capture.what === "object" &&
                capture.what.prop == propName) {
              prop = capture.what.value;
            }
            return false;
          }, this);
        } else {
          var prop = obj.props[propName];
        }
        if (!matchFunc(prop)) {
          continue;
        }
        UI.addResult(obj).addClass("result").css("color", coloring);
      }
    },
  }; // logan impl

})();
