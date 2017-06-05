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
  return file.name.test(/\.child-\d+(?:\.\d)?$/);
}

function isRotateFile(file)
{
  return file.name.test(/\.\d$/);
}

const printfToRegexpMap = {
  "[\\-\\[\\]\\/\\{\\}\\(\\)\\*\\+\\?\\.\\\\\\^\\$\\|]" : "\\$&",
  "%p": "([A-F0-9]+)",
  "%d": "([\\d]+)",
  "%s": "([^\\s,;]+)",
  "%x": "((?:0x)?[A-F0-9]+)",
};

function convertPrintfToRegexp(printf)
{
  for (let source in printfToRegexpMap) {
    var target = printfToRegexpMap[source];
    printf = printf.replace(RegExp(source), target);
  }

  return new RegExp('^' + printf + '$');
}

const FILE_SLICE = 10 * 1024 * 1024;
const LINE_MAIN_REGEXP = /^(\d+-\d+-\d+ \d+:\d+:\d+.\d+) \w+ - \[([\w\s#\(\)]+)\]: ([A-Z])\/(\w+) (.*)$/;

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
        },
        id: logan.objects.length, // unique per all processed log files
        linksTo: [], // lists obj.id
        linkedBy: [], // lists obj.id
        createOffset: logan.fileoffset,
        createTime: this.timestamp
      };
      logan.objects.push(obj);
      this.objs[self] = obj;

      ensure(logan.searchProps, className, { className: true, pointer: true });

      return obj;
    },

    destroy: function(self)
    {
      var obj = (typeof self === "object") ? self : this.objs[self];
      if (!obj) {
        console.warn("Object doesn't exist at " + logan.filename + ":" + logan.linenumber);
        return;
      }

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

      src.linksTo.push(trg.id);
      trg.linkedBy.push(src.id);
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


  // The rest is considered private
  
  consumeFiles: function(files)
  {
    this.objects = [];
    this.searchProps = {};

    for (let file of files) {
      this.consumeFile(file);
    }
  },

  consumeFile: function(file, offset = 0, previousLine = "")
  {
    if (offset === 0) {
      this._proc.threads = {};
      this._proc.objs = {};

      this.eollength = 1;
      this.fileoffset = 0;
      this.linenumber = 0;
      logan.filename = file.name;
    }

    var blob = file.slice(offset, offset + FILE_SLICE);
    if (blob.size == 0) {
      if (previousLine) {
        this.consumeLine(file, previousLine);
      }
      this.processEOF();
      this._proc.file = null;
      return;
    }

    this._proc.file = file;

    var reader = new FileReader();
    reader.onloadend = function(event) {
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

        this.consumeFile(file, offset + FILE_SLICE, previousLine);
      }
    }.bind(this);
    reader.onerror = (event) => { alert(event); }
    reader.readAsBinaryString(blob);
  },

  consumeLine: function(file, line)
  {
    this._proc.lineBinaryOffset = this.fileoffset;
    this.fileoffset += line.length + this.eollength;
    ++this.linenumber;

    var main = line.match(LINE_MAIN_REGEXP);
    if (!main) {
      this.processLine(this._rules.unmatch, file, text);
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
      if (rule.cond && !rule.cond.bind(this._proc)()) {
        continue;
      }

      if (!rule.regexp) {
        continue;
      }

      var match = line.match(rule.regexp)
      if (!match) {
        continue;
      }

      this._proc.match = match;
      rule.consumer.apply(this._proc, match.slice(1));

      // we are here only once per each line of a file when match is hit
      // hence, it's the place to do any final operations on what has been
      // done by the matching consumer
      return true;
    }

    return false;
  },

  processEOF: function ()
  {
    alert("done parsing files");
    for (let obj of this.objects) {
      console.log(obj.props);
    }
  },
}; // logan impl

$(() => {
  $("#files").on("change", (event) => {
    logan.consumeFiles(event.target.files);
  });
  logan.consumeFiles($("#files").get()[0].files);
});

})();
