(function() {

  // Configuration of the UI
  const LOAD_LINES_ON_SCROLL = true;
  const ON_SCROLL_LINES_COUNT = 20;
  const AUTO_FETCH_INITIAL_DELAY = 250;
  const AUTO_FETCH_DELAY_DECAY = 32;
  // -----------------------

  function ensure(array, itemName, def = {}) {
    if (!(itemName in array)) {
      array[itemName] = (typeof def === "function") ? def() : def;
    }

    return array[itemName];
  }

  function withAlpha(colorString, alpha) {
    let match = colorString.match(/#?([A-Fa-f0-9]{2})([A-Fa-f0-9]{2})([A-Fa-f0-9]{2})/);
    return "rgba(" + parseInt(match[1], 16) + "," + parseInt(match[2], 16) + "," + parseInt(match[3], 16) + "," + alpha + ")";
  }

  (function() {
    var timeouts = [];
    var messageName = "zero-timeout-message";

    // Like setTimeout, but only takes a function argument.  There's
    // no time argument (always zero) and no arguments (you have to
    // use a closure).
    function setZeroTimeout(fn) {
      timeouts.push(fn);
      window.postMessage(messageName, "*");
    }

    function handleMessage(event) {
      if (event.source == window && event.data == messageName) {
        event.stopPropagation();
        if (timeouts.length > 0) {
          var fn = timeouts.shift();
          fn();
        }
      }
    }

    window.addEventListener("message", handleMessage, true);

    // Add the one thing we want added to the window object.
    window.setZeroTimeout = setZeroTimeout;
  })();

  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
  };

  const CLOSE_CROSS = "\u274C"; // "\u2A2F" = VECTOR OR CROSS PRODUCT (too small?);

  let HIGHLIGHTSET = ['#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f', '#8dd3c7'];
  function nextHighlightColor() {
    let result = HIGHLIGHTSET[0];
    HIGHLIGHTSET.push(HIGHLIGHTSET.shift());
    return result;
  }

  let SEARCHHIGHLIGH = ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'];
  function nextSearchColor() {
    let result = SEARCHHIGHLIGH[0];
    SEARCHHIGHLIGH.push(SEARCHHIGHLIGH.shift());
    return result;
  }

  let SEARCH_INDEXER = 0;
  let BREADCRUMB_INDEXER = 0;

  function parseHash() {
    let hash = unescape(location.hash.substr(1));
    try {
      return json = JSON.parse(hash);
    } catch (ex) {
      return {};
    }
  }
  function updateHash(json) {
    let hash = parseHash();
    for (let prop in json) {
      hash[prop] = json[prop];
    }
    location.hash = escape(JSON.stringify(hash));
  }
  function clearHash(name) {
    let hash = parseHash();
    delete hash[name];
    location.hash = escape(JSON.stringify(hash));
  }

  let UI = {
    searches: [],
    breadcrumbs: [],
    expandedElement: null,
    expanders: {},
    loadWhole: new Set(),
    warnings: {},
    display: {},
    dynamicStyle: {},
    activeRevealeres: 0,
    objColors: {},
    maxProgress: 0,
    currentProgress: 0,
    searchDisableCount: 0,
    searchByCache: null,
    mousedown: false,
    lastIncrement: 0,
    autoFetchDelay: AUTO_FETCH_INITIAL_DELAY,

    escapeHtml: function(string) {
      return String(string).replace(/[&<>"'`=\/]/g, function(s) {
        return entityMap[s];
      });
    },
    
    ISOTime: function(time) {
      return time ? time.toISOString().replace(/[TZ]/g, " ").trim() : "";
    },

    resetProgress: function() {
      this.maxProgress = 0;
      this.currentProgress = 0;
      this.loadProgress(0);
    },

    addToMaxProgress: function(size) {
      this.maxProgress += size;
    },

    addToLoadProgress: function(size) {
      this.currentProgress += size;
      this.loadProgress(this.currentProgress);
    },

    loadProgress: function(prog) {
      if (prog && this.maxProgress) {
        $("#load_progress").show().css("width", (prog * 100.0 / this.maxProgress) + "%");
      } else {
        $("#load_progress").hide();
      }
    },

    title: function(title) {
      document.title = (title + " - Logan");
    },

    warn: function(message) {
      if (message in this.warnings) {
        return;
      }
      this.warnings[message] = true;
      $("#warnings").show().text(Object.keys(this.warnings).join(" | "));
    },

    isPastEdge: function(element, up) {
      let top = $(window).scrollTop();
      let bottom = top + $(window).height();
      let elementTop = element.offset().top;

      const margin = 100;
      return up ? (elementTop > (top - margin)) : (elementTop < (bottom + margin));
    },

    setInitialView: function() {
      $("#file_load_section").removeClass().addClass("section").show();
      $("#searches").hide();
      $("#error_section").empty().hide();
      $("#search_section").hide();
      $("#netdiag_section").hide();
      $("#seek").hide();
      $("#breadcrumbs").hide();
    },

    setSearchView: function(reset) {
      $("#file_load_section").removeClass().addClass("topbar").show();
      $("#searches").hide();
      $("#error_section").empty().hide();
      $("#search_section").show();
      $("#netdiag_section").hide();
      $("#seek").hide();
      $("#breadcrumbs").hide();
      if (reset) {
        $("#search_className").empty();
        $("#search_By").empty();
        $("#results_section").empty();
        this.seekTo(0);
        this.objColors = {};
      }
    },

    searchingEnabled: function(enabled) {
      this.searchDisableCount += (enabled ? -1 : +1);

      $("#search_button").prop('disabled', !!this.searchDisableCount);
      $("#files").prop('disabled', !!this.searchDisableCount);
      $("#select_schema").prop('disabled', !!this.searchDisableCount);
    },

    setResultsView: function() {
      $("#search_section").removeClass().addClass("topbar").show();
      $("#searches").show();
      $("#error_section").hide();
      $("#results_section").show();
      $("#netdiag_section").hide();
      $("#seek").show();
      $("#breadcrumbs").show();
      $("#search_By").change();
    },

    setDiagnoseView: function() {
      $("#search_section").hide();
      $("#searches").hide();
      $("#error_section").hide();
      $("#results_section").hide();
      $("#netdiag_section").show();
      $("#seek").hide();
      $("#breadcrumbs").hide();
    },

    resetResultsView: function() {
      $("#results_section").empty();
      for (let expander of Object.values(this.expanders)) {
        expander("cleanup");
      }
      this.expanders = {};
      this.loadWhole = new Set();
      this.display = {};
    },

    clearResultsView: function() {
      $("#warnings").hide().empty();
      this.warnings = {};
      this.resetResultsView();
      $("#active_searches").empty();
      this.searches = [];
      $("#breadcrumbs > #list").empty();
      this.breadcrumbs = [];
      this.killer = null;
      $("#dynamic_style").empty();
      this.dynamicStyle = {};

      this.activeRevealeres = 0;
      this.inFocus = null;
      netdiagUI.reset();
    },

    seekTo: function(seekId) {
      if (seekId) {
        $("#seek_to_tail").show();
      } else {
        $("#seek_to_tail").hide();
        $("#seek_to").val("tail");
      }

      logan.seekId = seekId;
      this.redoSearches();
    },

    fillClassNames: function(classNames) {
      let select = $("#search_className");
      for (let className of Object.keys(classNames).sort()) {
        if (className !== "null") {
          select.append($("<option>").attr("value", className).text(className));
        }
      }
      select.append($("<option>").attr("value", '*').text('*'));
    },

    fillSearchBy: function(props) {
      let select = $("#search_By");
      select.empty();

      if (!props) {
        props = logan.searchProps[$("#search_className").val()] || {};
      }
      props = Array.from(new Set(
        Object.keys(props).concat([CAPTURED_LINE_LABEL, "pointer", "state"])
      )).sort();

      let use = "state";
      for (let prop of props) {
        select.append($("<option>").attr("value", prop).text(prop));

        if (prop == this.searchByCache) {
          use = prop;
        }
      }

      select.val(use);
    },
    
    loaded: function() {
      let show = parseHash().show;
      if (show) {
        let highlight = 0;
        this.setResultsView();
        for (let rec of show) {
          for (let obj of logan.objects) {
            if (obj.props.className === rec.name && obj.props.ordernum === rec.on) {
              let index = HIGHLIGHTSET.indexOf(rec.clr) + 1;
              highlight = Math.max(index, highlight);

              this.objColors[obj.id] = rec.clr;
              let element = this.addResult(obj);
              element.children(".checker").click();
            }
          }
        }
        while (highlight--) {
          nextHighlightColor();
        }
      }
    },

    closeDetails: function() {
      if (this.bc_details) {
        this.bc_details.remove();
      }
      this.bc_details = null;
    },

    addSearch: function(search) {
      search.id = ++SEARCH_INDEXER;
      this.searches.push(search);

      if (search.color === undefined) {
        search.color = nextSearchColor();
      }

      if (search.seekId === undefined) {
        search.seekId = logan.seekId;
        search.seekTime = $("#seek_to").val();
      }

      let descr = search.className;
      if (search.matching === "!!") {
        descr = "!!" + descr + "." + search.propName;
      } else if (search.matching === "!") {
        descr = "!" + descr + "." + search.propName;
      } else {
        descr += "." + search.propName + " " + search.matching + " " + search.value;
      }
      if (search.seekId !== 0) {
        descr += " @ " + search.seekTime;
      }
      let element = $("<div>")
        .addClass("search")
        .attr("id", "search-" + search.id)
        .css("color", search.color)
        .text(descr)
        .append($("<input>")
          .attr("type", "button")
          .val(CLOSE_CROSS)
          .addClass("button icon red")
          .click(function() { this.removeSearch(search); }.bind(this))
        );
      $("#active_searches").append(element);

      logan.search(
        this,
        search.className,
        search.propName,
        search.value,
        search.matching,
        search.seekId,
        search.color
      );

      return search;
    },

    removeSearch: function(search) {
      // This clears the UI and performs all remaining search again
      let index = this.searches.findIndex((item) => item.id == search.id);
      this.searches.splice(index, 1);
      this.redoSearches();
    },

    redoSearches: function() {
      let searches = this.searches.slice();
      let expanders = this.expanders;

      this.clearResultsView();
      for (search of searches) {
        this.addSearch(search);
      }

      this.expanders = expanders;
      for (let expander of Object.values(expanders)) {
        expander(true);
      }
    },

    objColor: function(obj) {
      return ensure(this.objColors, obj.id, nextHighlightColor);
    },

    highlight: function(input, at = 0, ignore = null) {
      if (typeof input === "object") {
        return "<span class='obj-" + input.id + "'>" + input.props.pointer + "</span>";
      }

      return input.replace(GREP_REGEXP, function(ptr) {
        let obj = logan.find(ptr, at);
        if (obj && obj !== ignore) {
          return `<span class='obj-${obj.id} inline-revealer' onclick='window.logan_inlineExpand(this, ${obj.id}, ${at});'>${ptr}</span>`;
        }
        return ptr;
      }.bind(this));
    },

    objHighlighter: function(obj, source = null, set) {
      source = source || obj;

      let color = this.objColor(source);
      let style = ".obj-" + obj.id + " { background-color: " + color + " !important}";

      return function(event) {
        if (set === true) {
          this.changeDynamicStyle("obj-" + obj.id, style);
        }
        // Deliberatly leaving the obj highlight in the style...
        /* else if (set === false) {
          this.changeDynamicStyle("obj-" + obj.id);
        } else {
          this.toggleDynamicStyle("obj-" + obj.id, style);
        } */
      }.bind(this);
    },

    summaryProps: function(props) {
      var custom = logan._summaryProps[props.className] || [];
      return ["className", "pointer", "state"].concat(custom);
    },

    summary: function(obj, propKeys = this.summaryProps, generate = (source, props) => {
      let summary = "";
      summary += this.ISOTime(obj.placement.time);
      for (let prop of props) {
        if (summary) summary += " \u2043 ";
        if (["className", "pointer", "state"].indexOf(prop) < 0) {
          summary += prop + "=";
        }
        summary += source.props[prop] == undefined ? "n/a" : source.props[prop];
      }
      return summary;
    }) {
      let props = propKeys(obj.props);

      if (!logan.seekId || obj.captures.last().id < logan.seekId) {
        // Object is younger than the seek point, just pick the final props state
        return generate(obj, props);
      }

      // Must collect properties manually
      // TODO - could be optimized by walking backwards until
      // all summary propeties are found
      let objAt = {
        props: {
          className: obj.props.className,
          pointer: obj.props.pointer,
          ordernum: obj.props.ordernum,
        },
        placement: obj.placement,
      };
      for (let capture of obj.captures) {
        if (capture.id > logan.seekId) {
          break;
        }
        if (typeof capture.what === "object" && capture.what.prop) {
          objAt.props[capture.what.prop] = capture.what.value;
        }
      }
      return generate(objAt, props);
    },

    quick: function(obj) {
      return (obj.props.className || "?:" + obj.id) + " @" + this.highlight(obj);
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
      if (logan.seekId && capture.id > logan.seekId) {
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

      element.attr("id", capture.id);

      let keys = Object.keys(this.display);
      keys.sort((a, b) => parseInt(a) - parseInt(b));
      let following = keys.find((a) => parseInt(a) > parseInt(position));

      if (following === undefined) { // can be last
        $("#results_section").append(element);
      } else { // has to be placed before
        element.insertBefore(this.display[following]);
      }

      element.__refs = 1;
      element.data("capture", capture);
      return (this.display[position] = element);
    },

    addCaptures: function(obj, captureid, totop = true, tobottom = true) {
      if (!obj._extraCaptures) {
        obj._extraCaptures = {};
      }

      if (!LOAD_LINES_ON_SCROLL) {
        for (let capture of obj.captures) {
          this.addCapture(obj, capture);
        }
        for (let capture of Object.values(obj._extraCaptures)) {
          this.addCapture(obj, capture, true);
        }

        return;
      }

      let process = (origin, up, handlername) => {
        let filter = (captures, extra) => {
          let index = captures.findIndex(c => c.id > origin);
          let slice = up
            ? captures.slice(0, index < 0 ? (captures.length - 1) : index)
            : captures.slice(index < 0 ? captures.length : index);
          return slice.map(capture => ({ capture, extra }));
        } // filter()

        let regular = filter(obj.captures, false);
        let extra = filter(Object.values(obj._extraCaptures), true);
        let captures = regular.concat(extra).sort((a, b) => a.capture.id - b.capture.id);

        let observer = ensure(obj, handlername, () => {
          return $("<div>").addClass("scroll-observer").on("custom", () => {
            if (this.loadWhole.has(obj.id) || this.isPastEdge(observer, up)) {
              this.addCaptures(obj, observer.data("nextid"), up, !up);
            }
          });
        });

        // Can't use the observer, since it's moving up as we add new capture lines
        let scrollanchor = observer.next(".log_line");
        scrollanchor = scrollanchor.length && $(scrollanchor[0]);
        let scrolloffset = scrollanchor && (scrollanchor.offset().top - $(window).scrollTop());

        let id, element;
        let count = ON_SCROLL_LINES_COUNT;
        while (count && captures.length) {
          let capture = up ? captures.pop() : captures.shift();
          let added = this.addCapture(obj, capture.capture, capture.extra);

          id = capture.capture.id;
          element = added || element;

          if (added) {
            // we've added an actual line!
            count--;
          }
        }

        if (!element) {
          if (obj[handlername]) {
            obj[handlername].remove();
            delete obj[handlername];
          }
          return;
        }

        if (up) {
          if (totop != tobottom && scrollanchor) {
            $(window).scrollTop(scrollanchor.offset().top - scrolloffset);
          }
          observer.insertBefore(element);
          observer.data("nextid", id - 1);
        } else {
          observer.data("nextid", id);
          observer.insertAfter(element);
        }

        setZeroTimeout(() => observer.trigger("custom"));
      } // process()

      if (totop) {
        process(captureid, true, "scrollHandlerTop");
      }
      if (tobottom) {
        process(captureid, false, "scrollHandlerBottom");
      }
    },

    objExpander: function(element, obj, placement, includeSummary, relation = {}) {
      return function() {
        let expander = this.expanders[obj.id];
        if (expander) {
          delete this.expanders[obj.id];
          expander(false);
          return;
        }

        expander = (expand, scrollanch = element) => {
          if (expand === "cleanup") {
            for (let handler of ["scrollHandlerTop", "scrollHandlerBottom"]) {
              if (handler in obj) {
                obj[handler].remove();
                delete obj[handler];
              }
            }
            return;
          }

          let scrolloffset = scrollanch.offset().top - $(window).scrollTop();

          // Must call in this order, since onExpansion wants to get the same color
          this.objColor(obj);
          this.objHighlighter(obj, obj, expand)();
          this.onExpansion(obj, relation, element, placement, expand);
          let spanselector = "span[objid='" + obj.id + "'";
          if (expand === true) {
            if (includeSummary && obj.props.className) {
              this.addSummary(obj);
            }
            element.addClass("checked");
            logan.deferReadCapture();
            try {
              this.addCaptures(obj, placement.id);
            } finally {
              logan.commitReadCapture();
            }

            // Makes sure any newly added expanders on already expanded objects are checked
            $(spanselector).addClass("expanded");
            for (let objid in this.expanders) {
              spanselector = "span[objid='" + objid + "'";
              $(spanselector).addClass("expanded");
            }
          } else if (expand === false) {
            $(spanselector).removeClass("expanded");
            if (includeSummary && obj.props.className) {
              this.removeLine(this.position(obj.placement));
            }
            element.removeClass("checked");
            for (let capture of obj.captures) {
              this.removeLine(this.position(capture));
            }
            for (let capture of Object.values(obj._extraCaptures)) {
              this.removeLine(this.position(capture));
            }
            expander("cleanup");
          }

          $(window).scrollTop(scrollanch.offset().top - scrolloffset);

          updateHash({
            show: Object.keys(this.expanders).map(function(id) {
              let obj = logan.objects[id];
              return { name: obj.props.className, on: obj.props.ordernum, clr: this.objColor(obj) };
            }, this)
          });
        }

        this.expanders[obj.id] = expander;
        expander(true);
      }.bind(this);
    },

    addRevealer: function(obj, builder, placement = null, includeSummary = false, relation = {}) {
      placement = placement || obj.placement;

      let element = $("<div>");
      element
        .addClass("log_line")
        .addClass(() => includeSummary ? "" : "summary")
        .append($("<span>").attr("objid", obj.id).addClass("checker")
          .click(this.objExpander(element, obj, placement, includeSummary, relation))
        );

      builder(element);
      return this.place(placement, element);
    },

    addResult: function(obj, searchProp) {
      return this.addRevealer(obj, (element) => {
        element
          .append($("<span>")
            .addClass("obj-" + obj.id).addClass("pre")
            .text(this.summary(obj, (props) => {
              // This prepends the property we searched the object by
              let result = this.summaryProps(props);
              if (searchProp && result.indexOf(searchProp) < 0 && searchProp !== CAPTURED_LINE_LABEL) {
                result.unshift(searchProp);
              }
              return result;
            })))
          ;
      });
    },

    addSummary: function(obj) {
      let element = $("<div>")
        .addClass("log_line expanded summary obj-" + obj.id)
        .append($("<span>").addClass("pre")
          .text(this.summary(obj)))
        ;

      return this.place(obj.placement, element);
    },

    addCapture: function(obj, capture, extra = false) {
      if (!capture.what) {
        return;
      }

      let controller = () => {
        let fetch = (element, increment) => {
          // To loop
          UI.lastIncrement = increment;

          let fromTop = $(element).parents(".log_line").offset().top - $(window).scrollTop();
          fromTop |= 1; // to fix the jumping effect in Firefox

          let id = capture.id + increment;
          let next;

          // Next on the same thread.
          while ((next = logan.captures[id])) {
            if ((next.what.file || (typeof next.what === "string")) && next.thread === capture.thread) {
              break;
            }
            id += increment;
            next = null;
          }
          if (!next) {
            return;
          }

          let position = this.position(next);
          if (position in obj._extraCaptures) {
            // Already added as part of this object.
            return;
          }

          obj._extraCaptures[position] = next;

          if (position in this.display) {
            // Already on the screen, but added via a different path, add a ref
            this.place(next, this.display[position]);
          } else {
            element = this.addCapture(obj, next, true);
            if (increment > 0) {
              $(window).scrollTop(element.offset().top - fromTop);
            }
          }
        }

        let up = $("<span>")
          .attr('title', 'Fetch previous line on this thread')
          .text('\u2303')
          .mousedown(function() {
            fetch(this, -1);
          });
                
        let down = $("<span>")
          .attr('title', 'Fetch next line on this thread')
          .text('\u2304')
          .mousedown(function() {
            fetch(this, +1);
          });
        
        if (UI.mousedown) {
          setTimeout(() => {
            if (UI.mousedown && UI.lastIncrement != 0) {
              let target = UI.lastIncrement > 0 ? down : up;
              fetch(target, UI.lastIncrement);

              UI.autoFetchDelay -= AUTO_FETCH_DELAY_DECAY;
              if (UI.autoFetchDelay < 0) UI.autoFetchDelay = 0;
            }
          }, UI.autoFetchDelay);
        }

        return $("<span>")
          .addClass("line_controller")
          .append(up)
          .append(down)
          .mousedown((e) => {
            e.preventDefault();
          })
        ;
      };

      let classification = () => !extra ? ("noextra obj-" + obj.id) : "extra";

      if (typeof capture.what == "object") {
        let file = capture.what.file;
        if (file) {
          let offset = capture.what.offset;
          let span = $("<span>").addClass("pre").text(" loading...");
          let element = $("<div>")
            .addClass("log_line expanded")
            .addClass(classification())
            .append(controller())
            .append(span);

          logan.readCapture(capture).then((line) => {
            span.html(this.highlight(this.escapeHtml(line), capture.id, obj));
          });

          return this.place(capture, element);
        }

        let linkFrom = capture.what.linkFrom;
        let linkTo = capture.what.linkTo;
        if (linkTo && linkFrom) {
          let relation = { from: linkFrom, to: linkTo };
          let target = obj === linkTo ? linkFrom : linkTo;
          return this.addRevealer(target, (element) => {
            element
              .addClass("expanded revealer")
              //.addClass("obj-" + obj.id)
              .append($("<span>").addClass("pre")
                .html(this.quick(linkFrom) + " --> " + this.quick(linkTo)))
          }, capture, true, relation);
        }

        let expose = capture.what.expose;
        if (expose) {
          return this.addRevealer(expose, (element) => {
            element
              .addClass("expanded revealer")
              //.addClass("obj-" + obj.id)
              .append($("<span>").addClass("pre").html(this.quick(expose)))
          }, capture, true);
        }

        // An empty or unknown capture is just ignored.
        return;
      }

      let element = $("<div>")
        .addClass("log_line expanded")
        .addClass(classification())
        .append(controller())
        .append($("<span>").addClass("pre").html(this.highlight(
          this.escapeHtml(capture.what), capture.id, obj
        )));

      return this.place(capture, element);
    },

    removeLine: function(position) {
      if (this.display[position] && --this.display[position].__refs === 0) {
        this.display[position].remove();
        delete this.display[position];
      }
    },

    relationId: function(relation) {
      if (!relation.from) {
        return 0;
      }
      return (relation.from.id << 16) + relation.to.id;
    },

    // @param capture: the capture that revealed the object so that we can
    //                 reconstruct expansions on re-search.
    addBreadcrumb: function(expand, obj, relation, capture) {
      if (expand) {
        expand.refs++;
        return;
      }

      if (this.bc_details) {
        // Because we append to
        this.bc_details.remove();
      }

      expand = {
        obj: obj,
        relation: relation,
        refs: 1,
        capture: capture,
        index: ++BREADCRUMB_INDEXER,
        element: $("<span>")
          .addClass("branch").addClass(() => (relation.to === obj) ? "child" : "parent")
          .css("background-color", this.objColor(obj))
          .html(this.quick(obj))
          .append($("<input>").attr("type", "button").addClass("button icon red").val(CLOSE_CROSS)
            .click(function(event) {
              let expander = this.expanders[obj.id];
              if (expander) {
                delete this.expanders[obj.id];
                expander(false);
              }
            }.bind(this))
          )
          .click(function(event) {
            if (this.bc_details) {
              this.bc_details.remove();
            }
            let element = $("<div>")
              .addClass("breadcrumb_details")
              .css("background-color", withAlpha(this.objColor(obj), 0.4))
              .append($("<input>").attr("type", "button").addClass("button icon close").val(CLOSE_CROSS)
                .click(function() {
                  if (this.bc_details) {
                    this.bc_details.remove();
                  }
                }.bind(this))
              )
              .append($("<input>").attr("type", "button").addClass("button").val("diagnose").css("margin-bottom", "1em")
                .click(function() {
                  netdiagUI.diagnose(this, obj);
                }.bind(this))
              )
              .append($("<input>").attr("type", "button").addClass("button").val("load all lines").css("margin-bottom", "1em")
                .click(function() {
                  this.loadWhole.add(obj.id);
                  $(window).scroll();
                }.bind(this))
              )
            this.summary(obj, Object.keys, (obj, props) => {
              element.append($("<div>")
                .html(this.quick(obj) + " created " + this.ISOTime(obj.placement.time) + " (" + obj.placement.file.name + ")"));
              for (let prop of props.sort()) {
                element.append($("<div>").text(prop + " = " + obj.props[prop]));
              }
            });

            $("#list").append(this.bc_details = $("<div>").append(element).append("<br>"));
          }.bind(this)),
      };

      if (!this.killer) {
        this.killer = $("<span>")
          .addClass('red delete-all')
          .html("&#x232b;")
          .attr('title', `Close all expanded objectes and remove coloring`)
          .click(() => {
            this.killer.remove();
            this.killer = null;

            this.objColors = {};
            this.resetResultsView();
            clearHash("show");
            this.redoSearches();
          });
        $("#list").append(this.killer);
      }

      $("#list").append(expand.element);
      this.breadcrumbs.push(expand);
    },

    removeBreadcrumb: function(expand, obj) {
      if (this.bc_details) {
        this.bc_details.remove();
      }
      if (!expand) {
        throw "Internal error - expand in the tree not found";
      }

      expand.refs--;
      if (!expand.refs) {
        expand.element.remove();
        this.breadcrumbs.remove(item => item.obj === expand.obj);
      }

      if (!this.breadcrumbs.length) {
        $("#show_map").hide();
      }
    },

    onExpansion: function(obj, relation, revealer, capture, revealed) {
      if (this.inFocus) {
        this.inFocus.removeClass("focused");
      }
      this.inFocus = revealer;
      this.inFocus.addClass("focused");

      let expand = this.breadcrumbs.find(item => item.obj === obj);
      if (revealed) {
        this.addBreadcrumb(expand, obj, relation, capture);
      } else {
        this.removeBreadcrumb(expand, obj);
      }

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

      let content = Object.values(this.dynamicStyle).join("\n");
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

  window.logan_inlineExpand = (element, objid, placementid) => {
    element = $(element);

    let expander = UI.expanders[objid];
    if (expander) {
      delete UI.expanders[objid];
      expander(false, element);
      return;
    }

    UI.objExpander(element, logan.objects[objid], logan.captures[placementid], false)();
  };

  $(() => {
    logan.init();

    consume = () => {
      var files = $("#files").get()[0].files;
      if (location.search) {
        UI.clearResultsView();
        UI.setSearchView(true);
        logan.consumeURL(UI, unescape(location.search.substr(1)));
      } else if (files.length) {
        UI.clearResultsView();
        UI.setSearchView(true);
        logan.consumeFiles(UI, files, $("#cache").prop("checked"));
      } else {
        UI.setInitialView();
      }
    }

    let select_schema = $("#select_schema").change((select) => {
      updateHash({ schema: select_schema.val() });
      logan.activeSchema(select_schema.val());
      consume();
    });
    for (let schema in logan._schemes) {
      select_schema.append($("<option>").attr("value", schema).text(schema));
    }

    let schema_name = parseHash().schema;
    let active_schema = logan.activeSchema(schema_name);
    if (!active_schema) {
      alert("There is no schema '" + schema_name + "'");
    } else {
      select_schema.val(active_schema.namespace);
    }

    window.onerror = function(err) {
      $("#error_section").show().text(err.message || err);
    };

    $("#files").on("change", (event) => {
      UI.clearResultsView();
      UI.setSearchView(true);
      logan.consumeFiles(UI, event.target.files, $("#cache").prop("checked"));
    });

    $("#load_url").click((event) => {
      location.search = escape($("#url").val());
    });

    let search_By = $("#search_By").on("change", (event) => {
      if (event.originalEvent) {
        // a hacky way to recognize this is not a call to .change()
        // but that actually comes from a user interaction.

        UI.searchByCache = search_By.val();
      }
    }).change();

    $("#search_Matching").on("change", (event) => {
      (event.target.value === "!!" || event.target.value === "!")
        ? $("#search_PropValue").hide() : $("#search_PropValue").show();
    }).change();

    $("#search_className").on("change", (event) => {
      let props = logan.searchProps[event.target.value];
      UI.fillSearchBy(props);
    });

    $("#search_button").click(function(event) {
      if (logan.reader) {
        return;
      }
      UI.setResultsView();
      UI.addSearch({
        className: $("#search_className").val(),
        propName: $("#search_By").val(),
        value: $("#search_PropValue").val().trim(),
        matching: $("#search_Matching").val(),
      });
    }.bind(this));

    let linePicker = function(event) {
      $("#results_section > div.log_line").each((i, element) => {
        element.removeEventListener("click", linePicker, true);
      });

      $("#seek_to").attr("disabled", null);
      UI.changeDynamicStyle("linepick");

      if (!event) {
        // Called manually to reset
        return;
      }

      $("#seek_to").val(this.textContent.match(/(\d+:\d+:\d+\.\d+)/)[1] || this.textContent);
      UI.seekTo(parseInt(this.getAttribute("id")));

      event.stopPropagation();
    }
    $("#seek_to").click((event) => {
      $("#results_section > div.log_line").each((i, element) => {
        element.addEventListener("click", linePicker, true);
      });
      UI.changeDynamicStyle("linepick", "div.log_line:hover { cursor: alias !important; background-color: black !important; color: white !important }");
    });
    $("#seek_to_tail").click((event) => {
      UI.seekTo(0);
    });

    let escapeHandler = (event) => {
      if (event.keyCode == 27) {
        UI.closeExpansion();
        linePicker();
      }
    };
    $(document).keydown(escapeHandler);
    $("#seek_to").keydown(escapeHandler);

    $(window).scroll(() => {
      logan.deferReadCapture();
      try {
        $(".scroll-observer").trigger("custom");
      } finally {
        logan.commitReadCapture();
      }
    });

    window.addEventListener("mousedown", (e) => {
      UI.mousedown = e.buttons == 1;
      if (UI.mousedown) {
        UI.autoFetchDelay = AUTO_FETCH_INITIAL_DELAY;
      }
    }, true);

    $(window).mouseup((e) => {
      UI.mousedown = false;
      UI.lastIncrement = 0;
    });

    consume();
  });

})();
