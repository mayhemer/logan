var logan = null;

Array.prototype.last = function() {
  if (!this.length) {
    return undefined;
  }
  return this[this.length - 1];
};

Array.prototype.remove = function(element, finder) {
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
    "%x": "((?:0x)?[A-Fa-f0-9]+)",
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

  const FILE_SLICE = 1 * 1024 * 1024;
  const EPOCH_2015 = (new Date("2015-01-01")).valueOf();


  function Schema(namespace, lineRegexp, linePreparer) {
    this.namespace = namespace;
    this.lineRegexp = lineRegexp;
    this.linePreparer = linePreparer;
    this.modules = {};
    this.unmatch = [];
    this.ui = {
      summary: {}, // map: className -> prop to display on the summary line
    };
  }

  Schema.prototype.module = function(name, builder)
  {
    builder(ensure(this.modules, name, new Module(name)));
  }

  Schema.prototype.plainIf = function(condition, consumer) {
    this.unmatch.push({ cond: condition, consumer: consumer });
  };

  Schema.prototype.summaryProps = function(className, arrayOfProps) {
    this.ui.summary[className] = arrayOfProps;
  };


  function Module(name) {
    this.name = name;
    this.rules = [];
  }

  Module.prototype.rule = function(exp, consumer) {
    this.rules.push({ regexp: convertPrintfToRegexp(exp), cond: null, consumer: consumer });
  };

  Module.prototype.ruleIf = function(exp, condition, consumer) {
    this.rules.push({ regexp: convertPrintfToRegexp(exp), cond: condition, consumer: consumer });
  };


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
    ensure(this.logan.searchProps, className, { pointer: true, state: true });

    if (this.props.className) {
      throw "Recreating object! (are you missing destructor rule for this class?)";
    }
    this.props.className = className;
    this.prop("state", "created");
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
    this.prop("state", "released");
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
    that = this.logan._proc.obj(that);
    let capture = new Capture(this, { linkFrom: this, linkTo: that });
    this.capture(capture);
    that.capture(capture)._maybeShared(capture);
    return this;
  };

  Obj.prototype.mention = function(that) {
    if (typeof that === "string" && that.match(/^0+$/)) {
      return this;
    }
    that = this.logan._proc.obj(that);
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

    _schemes: {},
    _schema: null,

    schema: function(name, lineRegexp, linePreparer, builder) {
      this._schema = ensure(this._schemes, name, new Schema(name, lineRegexp, linePreparer));
      builder(this._schema);
    },

    activeSchema: function(name) {
      this._schema = this._schemes[name];
    },

    parse: function(line, regexp, consumer, failedConsumer) {
      if (!this.processRule(line, convertPrintfToRegexp(regexp), consumer) && failedConsumer) {
        failedConsumer(line);
      }
    },


    // The rest is considered private

    _filesToProcess: [],

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

      let match = line.match(this._schema.lineRegexp);
      if (!match) {
        this.processLine([this._schema.unmatch], file, line);
        return;
      }

      let [module, text] = this._schema.linePreparer.apply(null, [this._proc].concat(match));
      module = this._schema.modules[module] || { rules: [] };
      this.processLine([module.rules, this._schema.unmatch], file, text);
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
        case "==": {
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
        case "rx": {
          let regexp = new RegExp(matchValue, "g");
          matchFunc = function(prop) { return prop.match(regexp); }
          break;
        }
        case "!rx": {
          let nregexp = new RegExp(matchValue, "g");
          matchFunc = function(prop) { return !prop.match(nregexp); }
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
