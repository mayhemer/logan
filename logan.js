var logan = null;

Array.prototype.binaryFirstLessThenOrEqual = function(target, comparator)
{
  let t = this.length - 1;

  if (t == 0) {
    return undefined;
  }
  if (comparator(this[t], target) <= 0) {
    return this[t];
  }
  if (comparator(this[0], target) > 0) {
    return null;
  }

  let f = 0;
  do {
    var c = (t + f) >> 1;
    if (comparator(this[c], target) <= 0) {
      f = c;
    } else {
      t = c;
    }
  } while ((t - f) > 1);

  return this[f];
};

(function() {

function ensure(array, itemName, def = {})
{
  if (!(itemName in array)) {
    array[itemName] = def;
  }

  return array[itemName];
}

function isChildFile(file) {
  return file.name.match(/\.child-\d+(?:\.\d)?$/);
}

function isRotateFile(file)
{
  return file.name.match(/\.\d$/);
}

function escapeRegexp(s)
{
  return s.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

const printfToRegexpMap = {
  "%p": "([A-F0-9]+)",
  "%d": "([\\d]+)",
  "%s": "([^\\s,;]+)",
  "%x": "((?:0x)?[A-F0-9]+)",
};

function convertPrintfToRegexp(printf)
{
  printf = escapeRegexp(printf);

  for (let source in printfToRegexpMap) {
    var target = printfToRegexpMap[source];
    printf = printf.replace(RegExp(source, "g"), target);
  }

  return new RegExp('^' + printf + '$');
}

const FILE_SLICE = 512 * 1024;
const LINE_MAIN_REGEXP = /^(\d+-\d+-\d+ \d+:\d+:\d+.\d+) \w+ - \[([^\]]+)\]: ([A-Z])\/(\w+) (.*)$/;
const EPOCH_2015 = (new Date("2015-01-01")).valueOf();

function Obj(ptr, logan)
{
  this.id = logan.objects.length;
  this.props = { pointer: ptr, className: null };
  this.captures = [];
  this.references = 0;
  this.logan = logan;
  this.file = logan._proc.file;

  // This is used for placing the summary of the object (to generate
  // the unique ordered position, see UI.position.)
  // Otherwise there would be no other way than to use the first capture
  // that would lead to complicated duplications.
  this.placement = {
    time: this.logan._proc.timestamp,
    id: ++this.logan._proc.captureid,
  };

  logan.objects.push(this);
}

Obj.prototype.create = function(className)
{
  ensure(this.logan.searchProps, className, { pointer: true, state: true });

  if (this.props.className) {
    throw "recreating object (TODO)";
  }
  this.props.className = className;
  this.props.state = "created";
  return this.capture();
};

Obj.prototype.destroy = function()
{
  delete this.logan._proc.objs[this.props.pointer];
  this.props.state = "released";
  return this.capture();
};

function Capture(_proc, what)
{
  this.time = _proc.timestamp,
  this.line = _proc.linenumber,
  this.id = ++_proc.captureid,
  this.what = what;
}

Obj.prototype.capture = function(what)
{
  what = what || this.logan._proc.line;
  if (typeof what === "object" && "linkBy" in what) {
    ++this.references;
  }
  let capture = Capture.prototype.isPrototypeOf(what) ? what : new Capture(this.logan._proc, what);
  this.captures.push(capture);
  return this;
};

Obj.prototype.prop = function(name, value, merge = false)
{
  ensure(this.logan.searchProps, this.props.className)[name] = true;

  if (value === undefined) {
    delete this.props[name];
  } else if (typeof value === "function") {
    this.props[name] = value(this.props[name] || 0);
  } else if (merge && this.props[name]) {
    this.props[name] += value;
  } else {
    this.props[name] = value;
  }
  return this;
};

Obj.prototype.state = function(state)
{
  return this.prop("state", state);
};

Obj.prototype.links = function(that)
{
  that = logan._proc.obj(that);
  let capture = new Capture(this.logan._proc, { linkFrom: this, linkTo: that });
  this.capture(capture);
  that.capture(capture);
  return this;
};

Obj.prototype.guid = function(guid)
{
  this.guid = guid;
  ensure(logan._proc.global, "guids")[guid] = this;
};


// export
logan = {
  // processing state sub-object, passed to rule consumers
  // initialized in consumeFile(s)
  _proc: {
    obj: function(ptr)
    {
      if (typeof obj === "object") {
        return obj;
      }
      var obj = this.objs[ptr];
      if (!obj) {
        this.objs[ptr] = (obj = new Obj(ptr, logan));
      }
      return obj;
    },

    global_obj: function(guid)
    {
      return this.logan._proc.global.guids[guid] || new Obj(null, this.logan);
    }
  },

  _rules: {
    match: [],
    unmatch: [],
  },

  rule: function(exp, consumer)
  {
    this._rules.match.push({ regexp: convertPrintfToRegexp(exp), cond: null, consumer: consumer });
  },

  ruleIf: function(exp, condition, consumer)
  {
    this._rules.match.push({ regexp: convertPrintfToRegexp(exp), cond: condition, consumer: consumer });
  },

  plainIf: function(condition, consumer)
  {
    this._rules.unmatch.push({ cond: condition, consumer: consumer });
  },


  _ui: {
    summary: {}, // map: className -> prop to display on the summary line
  },

  summaryProps: function(className, arrayOfProps)
  {
    this._ui.summary[className] = arrayOfProps;
  },

  // The rest is considered private

  filesToProcess: [],

  consumeFiles: function(UI, files)
  {
    if (this.reader) {
      this.reader.abort();
    }
    this.objects = [];
    this.searchProps = {};
    this._proc.global = {};
    this._proc.captureid = 0;

    this.filesToProcess = Array.from(files);

    this.consumeFile(UI);
  },

  consumeFile: function(UI, file = null, offset = 0, previousLine = "")
  {
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
    this.reader.onloadend = function(event)
    {
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

    this.reader.onerror = function(event)
    {
      this.reader = null;
      alert(event);
    }.bind(this);

    this.reader.readAsBinaryString(blob);
  },

  consumeLine: function(UI, file, line)
  {
    ++this._proc.linenumber;
    this._proc.lineBinaryOffset = this.fileoffset;
    this.fileoffset += line.length + this.eollength;
    UI.loadProgress(this.fileoffset, file.size);

    var main = line.match(LINE_MAIN_REGEXP);
    if (!main) {
      this.processLine(this._rules.unmatch, file, line);
      return;
    }

    var [all, timestamp, thread, level, module, text] = main;
    this._proc.timestamp = new Date(timestamp);
    this._proc.thread = ensure(this._proc.threads, thread, { name: thread });

    if (!this.processLine(this._rules.match, file, text)) {
      this.processLine(this._rules.unmatch, file, text);
    }
  },

  processLine: function(ruleSet, file, line)
  {
    this._proc.line = line;
    for (let rule of ruleSet) { // optmize this!!!
      try {
        if (rule.cond && !rule.cond(this._proc)) {
          continue;
        }
      } catch (e) {
        alert("\"" + e.message + "\" while processing rule condition at " + e.fileName + ":" + e.lineNumber +
              "\n\nprocessed text: " + line + " at " + file.name + ":" + this._proc.linenumber +
              "\n\nFile loading stopped");
        throw e;
      }

      if (!rule.regexp) {
        rule.consumer.call(this._proc, line);
        return true;
      }

      var match = line.match(rule.regexp)
      if (!match) {
        continue;
      }

      this._proc.match = match;
      rule.consumer.apply(this._proc, match.slice(1));
      return true;
    }

    return false;
  },

  processEOF: function(UI)
  {
  },

  processEOS: function(UI)
  {
    UI.loadProgress(0);
    UI.fillClassNames(this.searchProps);
    UI.fillSearchBy();
  },

  search: function(UI, className, propName, matchValue, match)
  {
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
      default:
        throw "Unexpected match operator";
    }

    for (let obj of this.objects) {
      if (className != obj.props.className) {
        continue;
      }
      var prop = obj.props[propName] || "";
      if (!matchFunc(prop)) {
        continue;
      }
      UI.addObject(obj, "result");
    }
  },
}; // logan impl

var UI =
{
  expandedElement: null,
  display: {},
  dynamicStyle: {},

  loadProgress: function(prog, max = 1)
  {
    if (prog) {
      $("#load_progress").show().css("width", (prog * 100.0 / max) + "%");
    } else {
      $("#load_progress").hide();
    }
  },

  setInitialView: function()
  {
    $("#file_load_section").removeClass().addClass("section").show();
    $("#search_section").hide();
  },

  setSearchView: function(reset)
  {
    $("#file_load_section").removeClass().addClass("topbar").show();
    $("#search_section").show();
    if (reset) {
      $("#search_className").empty();
      $("#search_By").empty();
      $("#results_section").empty();
    }
  },

  setResultsView: function(reset)
  {
    $("#search_section").removeClass().addClass("topbar").show();
    $("#results_section").show();
    if (reset) {
      $("#results_section").empty();
      this.display = {};
      $("#dynamic_style").empty();
      this.dynamicStyle = {};
    }
  },

  fillClassNames: function(classNames)
  {
    let select = $("#search_className");
    for (let className in classNames) {
      if (className !== "null") {
        select.append($("<option>").attr("value", className).text(className));
      }
    }
  },

  fillSearchBy: function(props)
  {
    if (!props) {
      props = logan.searchProps[$("#search_className").val()] || {};
    }
    let select = $("#search_By");
    select.empty();
    for (let prop in props) {
      select.append($("<option>").attr("value", prop).text(prop));
    }
  },

  summaryProps: function(obj)
  {
    var custom = logan._ui.summary[obj.props.className] || [];
    return ["className", "pointer"].concat(custom);
  },

  summary: function(obj)
  {
    var props = this.summaryProps(obj);
    var summary = obj.placement.time.toISOString().replace(/[TZ]/g, " ").trim();
    for (let prop of props) {
      if (summary) summary += " \u2502 ";
      summary += obj.props[prop] || "-";
    }
    return summary;
  },

  quick: function(obj)
  {
    return (obj.props.className || "(" + obj.id + ")") + " @" + obj.props.pointer;
  },

  closeExpansion: function(newElement = null)
  {
    if (this.expandedElement) {
      this.expandedElement.remove();
    }
    this.expandedElement = newElement;
  },

  // this method is mostly meaningless, but leaving in case
  // I invent something smart here...
  // the plan to inteleave child processes is to process them
  // in parallel processing always the oldest line from all
  // open files on their respective cursors (yeah, fun..)
  position: function(capture)
  {
    if (!capture) {
      return 0;
    }
    return capture.id;
  },

  place: function(position, element)
  {
    if (this.display[position]) {
      // When a link revealer is turned on, it is readded (the object has the same capture)
      // Removing it would leave an element that is unchecked.
      this.display[position].__refs++;
      return this.display[position];
    }

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

  addRevealer: function(obj, builder, capture = null, includeSummary = false)
  {
    let element = $("<div>")
      .addClass("log_line")
      .addClass(() => includeSummary ? "" : "summary")
      .append($("<input type='checkbox'>")
        .on("change", function(event)
        {
          if (event.target.checked) {
            if (includeSummary) {
              this.addSummary(obj);
            }
            element.addClass("checked");
            for (let capture of obj.captures) {
              this.addCapture(obj, capture);
            }
          } else {
            if (includeSummary) {
              this.removeLine(this.position(obj.placement));
            }
            element.removeClass("checked");
            for (let capture of obj.captures) {
              this.removeLine(this.position(capture));
            }
          }
        }.bind(this))
      )
      .click(function(event) {
        // higlight
      });

    builder(element);
    this.place(this.position(capture || obj.placement), element);
    return element;
  },

  addSummary: function(obj)
  {
    let element = $("<div>")
      .addClass("log_line expanded summary")
      .addClass(() => (obj.references > 1) ? "shared" : "")
      .append($("<span>")
        .text(this.summary(obj)));

    this.place(this.position(obj.placement), element);
    return element;
  },

  addObject: function(obj)
  {
    this.addRevealer(obj, (element) =>
    {
      element
        .addClass(() => (obj.references > 1) ? "shared" : "")
        .append($("<span>")
          .text(this.summary(obj)));
    });
  },

  addCapture: function(obj, capture)
  {
    if (!capture.what) {
      return;
    }

    if (typeof capture.what == "object") {
      let linkFrom = capture.what.linkFrom;
      let linkTo = capture.what.linkTo;
      if (linkTo && linkFrom) {
        this.addRevealer(obj === linkTo ? linkFrom : linkTo, (element) =>
        {
          element
            .addClass("expanded")
            .append($("<span>")
              .text(this.quick(linkFrom) + " --> " + this.quick(linkTo)))
        }, capture, true);
      }
      return;
    }

    let time = capture.time.toISOString().replace(/[TZ]/g, " ").trim();
    let line = time + " \u2502 " + capture.what;
    let element = $("<div>")
      .addClass("log_line expanded")
      .addClass(() => (obj.references > 1) ? "shared" : "")
      .append($("<pre>").text(line));

    this.place(this.position(capture), element);
  },

  removeLine: function(position)
  {
    if (this.display[position] && --this.display[position].__refs === 0) {
      this.display[position].remove();
      delete this.display[position];
    }
  },
}; // UI

$(() => {
  $("#files").on("change", (event) =>
  {
    UI.setSearchView(true);
    logan.consumeFiles(UI, event.target.files);
  });

  $("#search_className").on("change", (event) =>
  {
    let props = logan.searchProps[event.target.value] || {};
    UI.fillSearchBy(props);
  });

  $("#search_button").click((event) =>
  {
    if (logan.reader) {
      return;
    }
    UI.setResultsView(true);
    logan.search(UI,
      $("#search_className").val(),
      $("#search_By").val(),
      $("#search_PropValue").val(),
      $("#search_Matching").val());
  });

  $(window).on("keypress", (event) =>
  {
    if (event.keyCode == 27) {
      UI.closeExpansion();
    }
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
