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

function Bag(def = {}) {
  for (let prop in def) {
    this[prop] = def[prop];
  }
}

Bag.prototype.on = function(prop, handler, elseHandler) {
  if (!this[prop]) {
    if (elseHandler) {
      elseHandler();
    }
    return;
  }
  let val = handler(this[prop], this);
  if (val) {
    return (this[prop] = val);
  }
  delete this[prop];
};

Bag.prototype.data = function(name, key) {
  let map = ensure(this, name, {});
  return ensure(map, key, () => new Bag());
};

const GREP_REGEXP = new RegExp("((?:0x)?[A-Fa-f0-9]{4,})", "g");
const POINTER_REGEXP = /^(?:0x)?0*([0-9A-Fa-f]+)$/;
const NULLPTR_REGEXP = /^(?:(?:0x)?0+|\(null\)|\(nil\))$/;
const CAPTURED_LINE_LABEL = "a log line";
const EPOCH_1970 = new Date("1970-01-01");

(function() {

  const FILE_SLICE = 1 * 1024 * 1024;
  const USE_RULES_TREE_OPTIMIZATION = true;

  let IF_RULE_INDEXER = 0;

  function isChildFile(file) {
    return file.name.match(/\.child-\d+(?:\.\d+)?$/);
  }

  function isRotateFile(file) {
    return file.name.match(/^(.*)\.\d+$/);
  }

  function rotateFileBaseName(file) {
    let baseName = isRotateFile(file);
    if (baseName) {
      return baseName[1];
    }

    return file.name;
  }

  function escapeRegexp(s) {
    return s.replace(/\n$/, "").replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
  }

  function unescapeRegexp(s) {
    return s.replace(/\\([\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|])/g, "$1");
  }

  const printfToRegexpMap = [
    // IMPORTANT!!!
    // Use \\\ to escape regexp special characters in the match regexp (left),
    // we escapeRegexp() the string prior to this conversion which adds
    // a '\' before each of such chars.
    [/%p/g, "((?:(?:0x)?[A-Fa-f0-9]+)|(?:\\(null\\))|(?:\\(nil\\)))"],
    [/%d/g, "(-?[\\d]+)"],
    [/%[hz]?u/g, "([\\d]+)"],
    [/%s/g, "([^\\s]*)"],
    [/%\\\*\\\$/g, "(.*$)"],
    [/%\\\*/g, "(.*)"], // this must process after %*$ because this one is more general
    [/%\d*[xX]/g, "((?:0x)?[A-Fa-f0-9]+)"],
    [/%(?:\d+\\\.\d+)?f/g, "((?:[\\d]+)\.(?:[\\d]+))"],
    [/%\\\/(.*)\\\/r/g, (m, p1) => "(" + unescapeRegexp(p1) + ")"]
  ];

  function convertPrintfToRegexp(printf) {
    if (RegExp.prototype.isPrototypeOf(printf)) {
      // already converted
      return printf;
    }

    let input = printf;
    printf = escapeRegexp(printf);

    for (let [source, target] of printfToRegexpMap) {
      printf = printf.replace(source, target);
    }
    printf = '^' + printf + '$';

    LOG("input '" + input + "' \nregexp '" + printf + "'");
    return new RegExp(printf);
  }

  // Windows sometimes writes %p as upper-case-padded and sometimes as lower-case-unpadded
  // 000001500B043028 -> 1500b043000
  function pointerTrim(ptr) {
    if (!ptr) {
      return "0";
    }

    let pointer = ptr.match(POINTER_REGEXP);
    if (pointer) {
      return pointer[1].toLowerCase();
    }

    return ptr;
  }

  function ruleMappingGrade1(input) {
    let splitter = /(\W)/;
    let grade1 = input.split(splitter, 1)[0];
    if (!grade1 || grade1.match(/%/g)) {
      // grade1 contains a dynamic part or is empty, use the whole input as mapping
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

  function Schema(namespace, preparer) {
    this.namespace = namespace;
    this.preparer = preparer;
    this.modules = {};
    this.unmatch = [];

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
        for (let regexp of [GREP_REGEXP, logan._proc.nonPtrAliases]) {
          if (!regexp) {
            break;
          }
          let pointers = state.line.match(regexp);
          if (pointers) {
            if (pointers.length === 1 && state.line.trim() == pointers[0]) {
              // It doesn't make sense to include lines only containing the pointer.
              // TODO the condition here should be made even smarter to filter out
              // more of just useless lines.
              break;
            }
            for (let ptr of pointers) {
              let obj = state.objs[pointerTrim(ptr)];
              if (obj && obj._grep) {
                obj.capture();
              }
            }
          }
        }
      }.bind(this), () => { throw "grep() internal consumer should never be called"; });
    };
  }


  Schema.prototype.module = function(name, builder) {
    builder(ensure(this.modules, name, new Module(name)));
  }

  Schema.prototype.plainIf = function(condition, consumer) {
    let rule = { cond: condition, consumer: consumer, id: ++IF_RULE_INDEXER };
    this.unmatch.push(rule);
    return rule;
  };

  Schema.prototype.ruleIf = function(exp, condition, consumer) {
    let rule = { regexp: convertPrintfToRegexp(exp), cond: condition, consumer: consumer, id: ++IF_RULE_INDEXER };
    this.unmatch.push(rule);
    return rule;
  };

  Schema.prototype.removeIf = function(rule) {
    this.unmatch.remove(item => item.id === rule.id);
  }


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

  Module.prototype.ruleIf = function(exp, condition, consumer) {
    this.set_rule({ regexp: convertPrintfToRegexp(exp), cond: condition, consumer: consumer }, exp);
  };


  function Obj(ptr) {
    this.id = logan.objects.length;
    // NOTE: when this list is enhanced, UI.summary has to be updated the "collect properties manually" section
    this.props = new Bag({ pointer: ptr, className: null, logid: this.id });
    this.captures = [];
    this.aliases = {};
    this._grep = false;
    this._dispatches = {};

    // This is used for placing the summary of the object (to generate
    // the unique ordered position, see UI.position.)
    // Otherwise there would be no other way than to use the first capture
    // that would lead to complicated duplications.
    this.placement = new Capture({ placement: this });
    this.placement.time = logan._proc.timestamp;

    logan.objects.push(this);
  }

  Obj.prototype.on = Bag.prototype.on;
  Obj.prototype.data = Bag.prototype.data;

  Obj.prototype.create = function(className, capture = true) {
    if (this.props.className) {
      console.warn(logan.exceptionParse("object already exists, recreting automatically from scratch "));
    }

    if (this.props.className || this.captures.length) {
      //
      // this.captures.length:
      //
      // An existing temporary object(no class) found with something captured on.
      // As this is very likely from a log line match right after a destructor line
      // we want to scratch that.  If this is an object created by e.g. mention() or
      // link() before class() or create() call then that mention/link will point
      // to a bad object!
      //
      // Correct solution:
      // 1. add a log at the end of a detructor and destroy() using that instead
      // 2. make sure a class()'ed only object is called class() before it's used
      //    the first time.
      //
      // This is not logged on purpose, since there is a lot of cases we recycle
      // pointers for which we have created temps from link() et al as well as
      // a lot of log lines written after object's respective destructor line.

      this.destroy(undefined /* always */, false /* no auto-capture */);
      return logan._proc.obj(this.__most_recent_accessor).create(className, capture);
    }

    ensure(logan.searchProps, className, { pointer: true, state: true, logid: true });

    this.props.className = className;
    this.prop("state", "created");

    if (capture) {
      this.capture();
    }
    return this;
  };

  Obj.prototype.alias = function(alias) {
    if (logan._proc.objs[alias] === this) {
      return this;
    }

    if (alias.match(NULLPTR_REGEXP)) {
      return this;
    }

    alias = pointerTrim(alias);
    logan._proc.objs[alias] = this;
    this.aliases[alias] = true;

    if (!alias.match(POINTER_REGEXP)) {
      logan._proc.update_alias_regexp();
    }

    return this;
  };

  Obj.prototype.unalias = function() {
    alias = this.__most_recent_accessor;
    if (!this.aliases[alias]) {
      return this;
    }

    delete logan._proc.objs[alias];
    delete this.aliases[alias];

    if (!alias.match(POINTER_REGEXP)) {
      logan._proc.update_alias_regexp();
    }

    return this;
  };

  Obj.prototype.destroy = function(ifClassName, capture = true) {
    if (ifClassName && this.props.className !== ifClassName) {
      return this;
    }

    delete logan._proc.objs[this.props.pointer];
    let updateAliasRegExp = false;
    for (let alias in this.aliases) {
      if (!alias.match(POINTER_REGEXP)) {
        updateAliasRegExp = true;
      }
      delete logan._proc.objs[alias];
    }
    this.prop("state", "released");
    delete this._references;

    if (updateAliasRegExp) {
      logan._proc.update_alias_regexp();
    }

    return capture ? this.capture() : this;
  };

  function Capture(what, obj = null) {
    what = what || {
      // This is a raw line capture.  We load them from disk when put on the screen.
      file: logan._proc.file,
      line: logan._proc.linenumber,
      offset: logan._proc.filebinaryoffset,
    };

    this.id = logan.captures.length;
    if (netdiag.enabled) {
      // This property takes surprisingly a lot of memory...
      this.time = logan._proc.timestamp;
    }
    this.thread = logan._proc.thread;
    this.obj = obj;
    this.what = what;

    logan.captures.push(this);
  }

  Obj.prototype.capture = function(what, info = null) {
    let capture = Capture.prototype.isPrototypeOf(what) ? what : logan.capture(what, this);

    if (info) {
      info.capture = capture;
      info.source = this;
      info.index = this.captures.length;
    }

    this.captures.push(capture);
    return this;
  };

  Obj.prototype.grep = function() {
    this._grep = true;
    return this;
  };

  Obj.prototype.expect = function(format, consumer = (obj) => { obj.capture() }, error = () => true) {
    let match = convertPrintfToRegexp(format);
    let obj = this;
    let thread = logan._proc.thread;
    let schema = logan._proc.schema;
    let rule = schema.plainIf(proc => {
      if (proc.thread !== thread) {
        return false;
      }

      if (!logan.parse(proc.line, match, function() {
        return consumer.apply(this, [obj].concat(Array.from(arguments)).concat([this]));
      }, line => {
        return error(obj, line);
      })) {
        schema.removeIf(rule);
      }
      return false;
    }, () => { throw "Obj.expect() handler should never be called"; });

    return this;
  };

  Obj.prototype.follow = function(cond, consumer = (obj) => obj.capture(), error = () => true) {
    let capture = {
      obj: this,
      module: logan._proc.module,
      thread: logan._proc.thread,
    };

    if (typeof cond === "number") {
      capture.count = cond;
      capture.follow = (obj, line, proc) => {
        obj.capture();
        return --capture.count;
      };
    } else if (typeof cond === "string") {
      capture.follow = (obj, line, proc) => {
        return logan.parse(line, cond, function() {
          return consumer.apply(this, [obj].concat(Array.from(arguments)).concat([this]));
        }, line => {
          return error(obj, line);
        });
      };
    } else if (typeof cond === "function") {
      capture.follow = cond;
    } else {
      throw logan.exceptionParse("follow() 'cond' argument unexpected type '" + typeof cond + "'");
    }

    logan._proc._pending_follow = capture;
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
      this.props[name] = value(this.props[name] || 0, this);
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
    let capture = new Capture({ linkFrom: this, linkTo: that }, this);
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

  Obj.prototype.class = function(className) {
    if (this.props.className) {
      // Already created
      return this;
    }
    return this.create(className, false).state("partial").prop("missing-constructor", true);
  };

  Obj.prototype.dispatch = function(target, name) {
    if (name === undefined) {
      target = this;
      name = target;
    }

    target = logan._proc.obj(target);

    let dispatch = {};
    this.capture({ dispatch: true }, dispatch);

    ensure(target._dispatches, name, []).push(dispatch);
    return this;
  },

  Obj.prototype.run = function(name) {
    let origin = this._dispatches[name];
    if (!origin) {
      return this;
    }

    let dispatch = origin.shift();
    if (!origin.length) {
      delete this._dispatches[name];
    }
    return this.capture({ run: dispatch }); // dispatch = { capture, source, index }
  },

  Obj.prototype.ipcid = function(id) {
    if (id === undefined) {
      return this.ipc_id;
    }
    this.ipc_id = id;
    return this.prop("ipc-id", id);
  },

  Obj.prototype.send = function(message) {
    if (!logan._proc._ipc) {
      return this;
    }
    if (this.ipc_id === undefined) {
      return this;
    }

    let create = () => {
      let origin = {};
      this.capture({ dispatch: true }, origin);
      LOG(" storing send() " + logan._proc.line + " ipcid=" + this.ipc_id);
      return {
        sender: this,
        origin: origin
      };
    };

    let id = message + "::" + this.ipc_id;
    let sync = logan._proc._sync[id];

    if (!sync) {
      logan._proc._sync[id] = create();
      return this;
    }

    if (sync.sender) {
      while (sync.next) {
        sync = sync.next;
      }
      sync.next = create();
      return this;
    }

    delete logan._proc._sync[id];

    LOG(" send() calling on stored recv() " + logan._proc.line + " ipcid=" + this.ipc_id);

    let proc = logan._proc.swap(sync.proc);
    logan._proc.file.__base.recv_wait = false;
    sync.func(sync.receiver, this);
    logan._proc.restore(proc);

    return this;
  },

  Obj.prototype.recv = function(message, func = () => {}) {
    if (!logan._proc._ipc) {
      return this;
    }

    if (this.ipc_id === undefined) {
      return this;
    }

    let id = message + "::" + this.ipc_id;

    let sync = logan._proc._sync[id];
    if (!sync) {
      // There was no send() call for this ipcid and message, hence
      // we have to wait.  Store the recv() info and proccessing state
      // and stop parsing this file.
      logan._proc._sync[id] = {
        func: func,
        receiver: this,
        proc: logan._proc.save(),
      };

      logan._proc.file.__base.recv_wait = true;

      LOG(" blocking and storing recv() " + logan._proc.line + " ipcid=" + this.ipc_id + " file=" + logan._proc.file.name);
      return this;
    }

    if (sync.next) {
      logan._proc._sync[id] = sync.next;
    } else {
      delete logan._proc._sync[id];
    }

    LOG(" recv() taking stored send() " + logan._proc.line + " ipcid=" + this.ipc_id);

    this.capture({ run: sync.origin });
    func(this, sync.sender);

    return this;
  },


  // export
  logan = {
    // processing state sub-object, passed to rule consumers
    _proc: {
      _obj: function(ptr, store) {
        if (Obj.prototype.isPrototypeOf(ptr)) {
          return ptr;
        }

        ptr = pointerTrim(ptr);
        if (ptr === "0") {
          store = false;
        }

        let obj = this.objs[ptr];
        if (!obj) {
          obj = new Obj(ptr);
          if (store) {
            this.objs[ptr] = obj;
            if (!ptr.match(POINTER_REGEXP)) {
              logan._proc.update_alias_regexp();
            }
          }
          obj.factual = store;
        }

        obj.__most_recent_accessor = ptr;
        return obj;
      },

      objIf: function(ptr) {
        return this._obj(ptr, false);
      },

      obj: function(ptr) {
        return this._obj(ptr, true);
      },

      service: function(name) {
        return this.obj(`${name}::service`).class(name).state("service");
      },

      duration: function(timestamp) {
        if (!timestamp) {
          return undefined;
        }
        return this.timestamp.getTime() - timestamp.getTime();
      },

      // private

      save: function() {
        return ["timestamp", "thread", "line", "file", "module", "raw", "filebinaryoffset"].reduce(
          (result, prop) => (result[prop] = this[prop], result), {});
      },

      restore: function(from) {
        for (let property in from) {
          this[property] = from[property];
        }
      },

      swap: function(through) {
        let result = this.save();
        this.restore(through);
        return result;
      },

      update_alias_regexp: function() {
        let nonPtrAliases = [];
        for (let obj of Object.keys(logan._proc.objs)) {
          if (!obj.match(POINTER_REGEXP)) {
            nonPtrAliases.push(escapeRegexp(obj));
          }
        }
        this.nonPtrAliases = nonPtrAliases.length === 0 ? null : new RegExp("(" + nonPtrAliases.join("|") + ")", "g");
      },
    },

    _schemes: {},
    _schema: null,
    _summaryProps: {},

    schema: function(name, preparer, builder) {
      this._schema = ensure(this._schemes, name, () => new Schema(name, preparer));
      builder(this._schema);
    },

    defaultSchema: function(name) {
      this._defaultSchema = name;
    },

    activeSchema: function(name) {
      name = name || this._defaultSchema;
      if (!this._schemes[name]) {
        return false;
      }

      return (this._schema = this._schemes[name]);
    },

    summaryProps: function(className, arrayOfProps) {
      if (this._summaryProps[className]) {
        console.warn(`Overriding summary properties of class ${className}`);
      }
      this._summaryProps[className] = arrayOfProps;
    },

    parse: function(line, printf, consumer, unmatch) {
      let result;
      if (!this.processRule(line, convertPrintfToRegexp(printf), function() {
        result = consumer.apply(this, arguments);
      })) {
        return (unmatch && unmatch.call(this._proc, line));
      }
      return result;
    },


    // The rest is considered private

    exceptionParse: function(exception) {
      if (typeof exception === "object") {
        exception = "'" + exception.message + "' at " + exception.fileName + ":" + exception.lineNumber + "\n";
      }
      exception += "while processing '" + this._proc.raw +
                   "'\nat " + this._proc.file.name + ":" + this._proc.linenumber;
      return new Error(exception);
    },

    files: [],

    init: function() {
      for (let schema of Object.values(this._schemes)) {
        schema._finalize();
      }
    },

    initProc: function(UI) {
      this.objects = [];
      this.captures = [];
      this.searchProps = {};
      this._proc.global = new Bag();
      this._proc._sync = {};
      delete this._proc.nonPtrAliases;

      let parents = {};
      let children = {};
      let bases = {};

      for (let file of this.files) {
        let basename = rotateFileBaseName(file);
        file.__base = ensure(bases, basename, () => ({
          name: basename, recv_wait: false,
        }));

        file.__base_order = 0; // will be updated from the first timestamp in the file
        if (isChildFile(file)) {
          file.__is_child = true;
          children[basename] = true;
        } else {
          parents[basename] = true;
        }
      }

      parents = Object.keys(parents).length;
      children = Object.keys(children).length;

      if (parents > 1) {
        UI.warn("More than one parent log - is that what you want?");
      }
      if (parents == 0 && children > 1) {
        UI.warn("Loading orphan child logs - is that what you want?");
      }

      this._proc._ipc = parents == 1 && children > 0;
      this._proc.threads = {};
      this._proc.objs = {};

      netdiag.reset();
    },

    consumeURL: function(UI, url) {
      this.seekId = 0;
      this.initProc(UI);

      fetch(url, { mode: 'cors', credentials: 'omit', }).then(function(response) {
        return response.blob();
      }).then(function(blob) {
        blob.name = "_net_"
        this.consumeFiles(UI, [blob]);
      }.bind(this));
    },

    consumeFiles: function(UI, files) {
      UI.searchingEnabled(false);

      this.files = Array.from(files);
      this.seekId = 0;
      this.initProc(UI);

      UI.resetProgress();

      files = [];
      for (let file of this.files) {
        if (!file.__is_child) {
          UI.title(file.__base.name);
        }
        files.push(this.readFile(UI, file));
      }

      Promise.all(files).then((files) => {
        this.consumeParallel(UI, files);
      });
    },

    readFile: function(UI, file, from = 0, line = 0, chunk = FILE_SLICE) {
      UI && UI.addToMaxProgress(file.size);

      file.__binary_offset = from;
      file.__line_number = line;

      let previousLine = "";
      let slice = (segmentoffset) => {
        return new Promise((resolve, reject) => {
          let blob = file.slice(segmentoffset, segmentoffset + chunk);
          if (blob.size == 0) {
            resolve({
              file: file,
              fromline: line,
              lines: [previousLine]
            });
            return;
          }

          let reader = new FileReader();
          reader.onloadend = (event) => {
            if (event.target.readyState == FileReader.DONE && event.target.result) {
              UI && UI.addToLoadProgress(blob.size);

              // Change chunk size to 5MB and Chrome self-time of shift() is 1000x slower!
              let lines = event.target.result.split(/(\r\n|\r|\n)/);

              // This simple code assumes that a single line can't be longer than FILE_SLICE
              lines[0] = previousLine + lines[0];
              previousLine = lines.pop();

              resolve({
                file: file,
                lines: lines,
                fromline: line,
                read_more: () => slice(segmentoffset + chunk)
              });
            }
          };

          reader.onerror = (event) => {
            console.error(`Error while reading at offset ${segmentoffset} from ${file.name}`);
            console.exception(reader.error);
            window.onerror(reader.error);

            reader.abort();
            reject(reader.error);
          };

          reader.readAsBinaryString(blob);
        });
      };

      return slice(from);
    },

    readCapture: async function(capture) {
      let file = capture.what.file;
      if (!file) {
        return Promise.reject();
      }

      let cache, promise;
      while (file.__cache_promise && promise !== file.__cache_promise) {
        promise = file.__cache_promise;
        cache = await promise;
        // If the promise has changed (a new load has started while we were waiting), await again
        // for this new cache to be resolved. Otherwise there would be a reload chain reaction.
      }

      let line = capture.what.line * 2; // text is interleaved with CRLFs

      if (!cache || (line < cache.fromline) || (cache.fromline + cache.lines.length) < line) {
        file.__cache_promise = new Promise((resolve, reject) => {
          this.readFile(null, file, capture.what.offset, line, FILE_SLICE).then((cache) => {
            if (!cache.lines.length) {
              reject();
              return;
            }

            resolve(cache);
          });
        });

        cache = await file.__cache_promise;
      }

      let text = cache.lines[line - cache.fromline];
      return Promise.resolve(text);
    },

    consumeParallel: async function(UI, files) {
      performance.mark("parsing-start");

      while (files.length) {
        // Make sure that the first line on each of the files is prepared
        // Preparation means to determine timestamp, thread name, module, if found,
        // or derived from the last prepared line
        singlefile: for (let file of Array.from(files)) {
          if (file.prepared) {
            continue;
          }

          do {
            if (!file.lines.length) {
              files.remove((item) => file === item);
              if (!file.read_more) {
                delete file.file.__binary_offset;
                delete file.file.__line_number;
                continue singlefile;
              }

              file = await file.read_more();
              files.push(file);
            }

            let line = file.lines.shift();

            let offset = file.file.__binary_offset;
            file.file.__binary_offset += line.length;

            if (line.match(/^[\r\n]+$/)) {
              continue;
            }

            file.file.__line_number++;

            if (!line.length) { // a blank line
              continue;
            }

            file.prepared = this.prepareLine(this._schema, line, file.previous);
            file.prepared.linenumber = file.file.__line_number;
            file.prepared.filebinaryoffset = offset;

            if (!file.file.__base_order) {
              file.file.__base_order = (file.prepared.timestamp && file.prepared.timestamp.getTime()) || 0;
            }

          } while (!file.prepared);
        } // singlefile: for

        if (!files.length) {
          break;
        }

        // Make sure the file with the earliest timestamp line is the first,
        // we then consume files[0].
        files.sort((a, b) => {
          if (!a.prepared.timestamp || !b.prepared.timestamp) {
            return a.file.__base_order - b.file.__base_order;
          }
          return a.prepared.timestamp.getTime() - b.prepared.timestamp.getTime() ||
            a.file.__base_order - b.file.__base_order; // overlapping of timestamp in rotated files
        });

        let consume = files.find(file => !file.file.__base.recv_wait);
        if (!consume) {
          // All files are blocked probably because of large timestamp shift
          // Let's just unblock parsing, in most cases we will satisfy recv()
          // soon after.
          consume = files[0];
        }

        this.consumeLine(this._schema, consume, consume.prepared);
        consume.previous = consume.prepared;
        delete consume.prepared;
      }

      this.processEOS(UI);

      performance.mark("parsing-end");
      performance.measure("parsing", "parsing-start", "parsing-end");
    },

    prepareLine: function(schema, line, previous) {
      previous = previous || {};

      let result = schema.preparer.call(null, line, this._proc);
      if (!result) {
        previous.module = 0;
        previous.text = line;
        result = previous;
      }

      result.raw = line;
      result.threadname = result.threadname || "default";
      result.module = result.module || "default";
      return result;
    },

    capture: function(what, obj) {
      if (!what) {
        if (!this._raw_capture) {
          this._raw_capture = new Capture(undefined, obj);
        }

        return this._raw_capture;
      }

      return new Capture(what, obj);
    },

    consumeLine: function(schema, consume, prepared) {
      this._raw_capture = null;

      this.consumeLineAndFollow(schema, consume, prepared);

      // make sure every line is captured
      this.capture();
    },

    consumeLineAndFollow: function(schema, consume, prepared) {
      if (!this.consumeLineByRules(schema, consume, prepared)) {
        let follow = this._proc.thread._engaged_follows[prepared.module];
        if (follow && !follow.follow(follow.obj, prepared.text, this._proc)) {
          delete this._proc.thread._engaged_follows[prepared.module];
        }
      }
    },

    ensureThread: function(file, prepared) {
      return ensure(this._proc.threads,
        file.__base.name + "|" + prepared.threadname,
        () => new Bag({ name: prepared.threadname, _engaged_follows: {} }));
    },

    consumeLineByRules: function(schema, consume, prepared) {
      this._proc.schema = schema;
      this._proc.file = consume.file;
      this._proc.timestamp = prepared.timestamp;
      this._proc.line = prepared.text;
      this._proc.raw = prepared.raw;
      this._proc.module = prepared.module;
      this._proc.linenumber = prepared.linenumber;
      this._proc.filebinaryoffset = prepared.filebinaryoffset;
      this._proc.thread = this.ensureThread(consume.file, prepared);

      let module = schema.modules[prepared.module];
      if (module && this.processLine(module.get_rules(prepared.text), consume.file, prepared)) {
        return true;
      }
      if (this.processLine(schema.unmatch, consume.file, prepared)) {
        return true;
      }

      if (prepared.forward) {
        for (let forward_schema in prepared.forward) {
          schema = this._schemes[forward_schema];
          if (!schema) {
            throw this.exceptionParse(`Missing farward-to schema ${forward_schema}`);
          }

          let text = prepared.forward[forward_schema];
          let forward_prepared = ensure(ensure(consume, "forward_prepared", {}), forward_schema, {});

          forward_prepared = this.prepareLine(schema, text, forward_prepared);
          forward_prepared.timestamp = forward_prepared.timestamp || prepared.timestamp;
          forward_prepared.linenumber = prepared.linenumber;
          forward_prepared.filebinaryoffset = prepared.filebinaryoffset;

          if (this.consumeLineAndFollow(schema, consume, forward_prepared)) {
            return true;
          }
        }
      }

      return false;
    },

    processLine: function(rules, file, prepared) {
      this._proc._pending_follow = null;

      if (this.processLineByRules(rules, file, prepared.text)) {
        if (this._proc._pending_follow) {
          // a rule matched and called follow(), make sure the right thread is set
          // this follow.
          let module = this._proc._pending_follow.module;
          this._proc._pending_follow.thread._engaged_follows[module] = this._proc._pending_follow;
          // for lines w/o a module use the most recent follow
          this._proc._pending_follow.thread._engaged_follows[0] = this._proc._pending_follow;
        } else {
          // a rule on the module where the last follow() has been setup has
          // matched, what is the signal to remove that follow.
          delete this._proc.thread._engaged_follows[prepared.module];
          delete this._proc.thread._engaged_follows[0];
        }
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

    processEOS: function(UI) {
      for (let sync_id in this._proc._sync) {
        let sync = this._proc._sync[sync_id];
        if (sync.receiver) {
          UI.warn("Missing some IPC synchronization points fulfillment, check web console");
          console.log(`file ${sync.proc.file.name} '${sync.proc.raw}', never received '${sync_id}'`);
        }
      }

      UI.loadProgress(0);
      UI.fillClassNames(this.searchProps);
      UI.fillSearchBy();
      UI.searchingEnabled(true);
    },

    search: async function(UI, className, propName, matchValue, match, seekId, coloring) {
      UI.searchingEnabled(false);

      var matchFunc;
      propToString = (prop) => (prop === undefined ? "" : prop.toString());
      switch (match) {
        case "==": {
          if (propName === "pointer") {
            matchFunc = prop => pointerTrim(matchValue) == prop;
          } else {
            matchFunc = prop => matchValue == propToString(prop);
          }
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

      let addResult = (obj) => {
        UI.addResult(obj, propName).addClass("result").css("color", coloring);
      }

      if (propName === CAPTURED_LINE_LABEL) {
        for (let capture of this.captures) {
          if (seekId && capture.id > seekId) {
            break;
          }
          if (!capture.obj || (className !== '*' && className != capture.obj.props.className)) {
            continue;
          }

          if (capture.what.file) {
            let line = await this.readCapture(capture);
            if (matchFunc(line)) {
              addResult(capture.obj);
            }
          } else if (typeof capture.what === "string" && matchFunc(capture.what)) {
            addResult(capture.obj);
          }
        }
      } else {
        for (let obj of this.objects) {
          if (className !== '*' && className != obj.props.className) {
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
              if (typeof capture.what === "object" && capture.what.prop == propName) {
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

          addResult(obj);
        }
      }

      UI.searchingEnabled(true);
    },
  }; // logan impl

})();
