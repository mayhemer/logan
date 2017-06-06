var logan = null;

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

const FILE_SLICE = 10 * 1024 * 1024;
const LINE_MAIN_REGEXP = /^(\d+-\d+-\d+ \d+:\d+:\d+.\d+) \w+ - \[([^\]]+)\]: ([A-Z])\/(\w+) (.*)$/;

// export
logan = {
  _proc: {
    create: function(self, className)
    {
      if (self in this.objs) {
        console.warn("Object already exists at " + logan.filename + ":" + logan.linenumber);
      }

      var obj = {
        props: {
          className: className,
          pointer: self,
          state: "init",
        },
        id: logan.objects.length, // unique per all processed log files
        linksTo: [], // lists obj.id
        linkedBy: [], // lists obj.id
        createFile: logan.filename,
        createOffset: logan.fileoffset,
        createTime: this.timestamp
      };
      logan.objects.push(obj);
      this.objs[self] = obj;

      // deliberately ommiting the className prop, since that is the first level default only
      ensure(logan.searchProps, className, { pointer: true, state: true });

      return obj;
    },

    destroy: function(self)
    {
      var obj = (typeof self === "object") ? self : this.objs[self];
      if (!obj) {
        console.warn("Object doesn't exist at " + logan.filename + ":" + logan.linenumber);
        return;
      }

      obj.props.state = "released";      
      obj.destroyFile = logan.filename;
      obj.destroyOffset = logan.fileoffset;
      obj.destroyTime = this.timestamp;
      delete this.objs[obj.props.pointer];
    },

    link: function(master, slave)
    {
      var src = (typeof master === "object") ? master : this.objs[master];
      var trg = (typeof slave === "object") ? slave : this.objs[slave];
      if (!src) {
        console.warn("Source object doesn't exist at " + logan.filename + ":" + logan.linenumber);
        return;
      }
      if (!trg) {
        console.warn("Target object doesn't exist at " + logan.filename + ":" + logan.linenumber);
        return;
      }

      src.linksTo.push([trg.id, logan.filename, logan.fileoffset]);
      trg.linkedBy.push([src.id, logan.filename, logan.fileoffset]);
    },

    prop: function(self, name, value, merge = false)
    {
      var obj = (typeof self === "object") ? self : this.objs[self];
      if (!obj) {
        console.warn("Object doesn't exist at " + logan.filename + ":" + logan.linenumber);
        return;
      }

      // Update the list of searchable object properties
      ensure(logan.searchProps, obj.props.className)[name] = true;

      if (merge && obj.props[name]) {
        obj.props[name] += value;
      } else {
        obj.props[name] = value;
      }
    },

    state: function(self, state)
    {
      prop(self, "state", state);
    },
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
      this.linenumber = 0;
      this.filename = file.name;
      this.fileoffset = 0;

      this._proc.threads = {};
      this._proc.objs = {};
      this._proc.file = file;
      this._proc.child = isChildFile(file);
    }

    var blob = file.slice(offset, offset + FILE_SLICE);
    if (blob.size == 0) {
      if (previousLine) {
        this.consumeLine(file, previousLine);
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
        this.consumeLine(file, previousLine);

        previousLine = lines.pop();
        for (let line of lines) {
          this.consumeLine(file, line);
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

  consumeLine: function(file, line)
  {
    this._proc.lineBinaryOffset = this.fileoffset;
    this.fileoffset += line.length + this.eollength;
    ++this.linenumber;

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
    for (let rule of ruleSet) { // optmize this!!!
      try {
        if (rule.cond && !rule.cond(this._proc)) {
          continue;
        }
      } catch (e) {
        // any exception from the condition checker is ignored
        continue;
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
      UI.addResult(obj);
    }
  },
}; // logan impl

var UI =
{
  expandedElement: null,
  results: {},

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
      this.results = {};
    }
  },

  setResultsView: function(reset)
  {
    $("#search_section").removeClass().addClass("topbar").show();
    $("#results_section").show();
    if (reset) {
      $("#results_section").empty();
      this.results = {};
    }
  },

  fillClassNames: function(classNames)
  {
    let select = $("#search_className");
    for (let className in classNames) {
      select.append($("<option>").attr("value", className).text(className));
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
    var summary = "";
    for (let prop of props) {
      if (summary) summary += " \u2502 ";
      summary += obj.props[prop] || "-";
    }
    return summary;
  },

  closeExpansion: function(newElement = null)
  {
    if (this.expandedElement) {
      this.expandedElement.remove();
    }
    this.expandedElement = newElement;
  },

  addResult: function(obj, under = null)
  {
    if (obj.id in this.results) {
      // already in the results!  we can alert :)
      return;
    }

    this.results[obj.id] = true;

    var summary = this.summary(obj);
    var element = $("<div>")
      .addClass("result_summary")
      .text(summary)
      .click(function(event)
      {
        var expansion = $("<div>").addClass("expansion");
        this.closeExpansion(expansion);

        var props = this.summaryProps(obj);
        for (let prop in obj.props) {
          if (!props.includes(prop)) {
            var propLines = obj.props[prop].trim().split(/\n/);
            for (propLine of propLines) {
              expansion.append($("<div>").addClass("prop").text(
                prop + ": " + propLine
              ));
            }
          }
        }

        if (obj.linksTo.length) {
          expansion.append($("<div>").addClass("label").text("Linking to"));
        }
        for (let linkto of obj.linksTo) {
          var trg = logan.objects[linkto[0]];
          expansion.append($("<div>").addClass("obj")
            .text(UI.summary(trg))
            .click(function(event)
            {
              this.closeExpansion();
              this.addResult(trg, element).click();
              event.stopPropagation();
            }.bind(this))
          );
        }

        if (obj.linkedBy.length) {
          expansion.append($("<div>").addClass("label").text("Linked by"));
        }
        for (let linkby of obj.linkedBy) {
          var trg = logan.objects[linkby[0]];
          expansion.append($("<div>").addClass("obj")
            .text(UI.summary(trg))
            .click(function(event)
            {
              this.closeExpansion();
              this.addResult(trg, element).click();
              event.stopPropagation();
            }.bind(this))
          );
        }

        element.append(expansion);
        event.stopPropagation();
      }.bind(this));

    if (!under) {
      element.addClass("searched");
      $("#results_section").append(element);
    } else {
      element.addClass("added");
      $("<div>").addClass("indent").append(element).insertAfter(under);
    }
    return element;
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
