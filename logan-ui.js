(function() {

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

  const CLOSE_CROSS = "\uD83D\uDDD9";

  let HIGHLIGHTSET = ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f'];
  function nextHighlightColor() {
    let result = HIGHLIGHTSET[0];
    HIGHLIGHTSET.push(HIGHLIGHTSET.shift());
    return result;
  }

  let SEARCH_INDEXER = 0;

  let UI =
    {
      searches: [],
      breadcrumbs: [],
      expandedElement: null,
      display: {},
      dynamicStyle: {},
      activeRevealeres: 0,
      objColors: {},

      loadProgress: function(prog, max = 1) {
        if (prog) {
          $("#load_progress").show().css("width", (prog * 100.0 / max) + "%");
        } else {
          $("#load_progress").hide();
        }
      },

      setInitialView: function() {
        $("#file_load_section").removeClass().addClass("section").show();
        $("#active_searches").hide();
        $("#search_section").hide();
        $("#seek").hide();
        $("#breadcrumbs").hide();
      },

      setSearchView: function(reset) {
        $("#file_load_section").removeClass().addClass("topbar").show();
        $("#active_searches").hide();
        $("#search_section").show();
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

      setResultsView: function() {
        $("#search_section").removeClass().addClass("topbar").show();
        $("#active_searches").show();
        $("#results_section").show();
        $("#seek").show();
        $("#breadcrumbs").show();
        $("#search_By").change();
      },

      clearResultsView: function() {
        $("#results_section").empty();
        this.display = {};
        $("#active_searches").empty();
        this.searches = [];
        $("#breadcrumbs").empty();
        this.breadcrumbs = [];
        $("#dynamic_style").empty();
        this.dynamicStyle = {};

        this.activeRevealeres = 0;
        this.inFocus = null;
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

      addSearch: function(search) {
        search.id = ++SEARCH_INDEXER;
        this.searches.push(search);

        let descr = search.className;
        if (search.matching !== "*") {
          descr += "." + search.propName + "\xa0" + search.matching + "\xa0" + search.value;
        }
        let element = $("<div>")
          .addClass("search")
          .attr("id", "search-" + search.id)
          .text(descr)
          .append($("<input>")
            .attr("type", "button")
            .val(CLOSE_CROSS) // X
            .addClass("button icon")
            .click(function() { this.removeSearch(search); }.bind(this))
          );
        $("#active_searches").append(element);

        logan.search(
          this,
          search.className,
          search.propName,
          search.value,
          search.matching
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
        let breadcrumbs = this.breadcrumbs.slice();

        this.clearResultsView();
        for (search of searches) {
          this.addSearch(search);
        }
        for (let expand of breadcrumbs) {
          let capture = this.display[expand.capture.id];
          if (capture) {
            capture.children("input[type=checkbox]").click();
          }
        }
      },

      objColor: function(obj) {
        return ensure(this.objColors, obj.id, function() {
          return nextHighlightColor();
        });
      },

      objHighlighter: function(obj, source = null, set) {
        source = source || obj;

        let color = this.objColor(source);
        let style = "div.log_line.obj-" + obj.id + " { background-color: " + color + "}";

        return function(event) {
          if (set === true) {
            this.changeDynamicStyle("obj-" + obj.id, style);
          } else if (set === false) {
            this.changeDynamicStyle("obj-" + obj.id);
          } else {
            this.toggleDynamicStyle("obj-" + obj.id, style);
          }
        }.bind(this);
      },

      summaryProps: function(props) {
        var custom = logan._schema.ui.summary[props.className] || [];
        return ["className", "pointer"].concat(custom);
      },

      summary: function(obj, propKeys = this.summaryProps, generate = (source, props) => {
        var summary = obj.placement.time.toISOString().replace(/[TZ]/g, " ").trim();
        for (let prop of props) {
          if (summary) summary += " \u2502 ";
          summary += source.props[prop] || "-";
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
        return (obj.props.className || "?:" + obj.id) + " @" + obj.props.pointer;
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
        return (this.display[position] = element);
      },

      addRevealer: function(obj, builder, placement = null, includeSummary = false, parent = null) {
        placement = placement || obj.placement;

        let element = $("<div>")
          .addClass("log_line obj-" + obj.id)
          .addClass(() => includeSummary ? "" : "summary")
          .append($("<input type='checkbox'>")
            .on("change", function(event) {
              let fromTop = element.offset().top - $(window).scrollTop();

              // Must call in this order, since onExpansion wants to get the same color
              this.objHighlighter(obj, obj, event.target.checked)();
              this.onExpansion(obj, parent, element, placement, event.target.checked);
              if (event.target.checked) {
                if (includeSummary && obj.props.className) {
                  this.addSummary(obj);
                }
                element.addClass("checked");
                for (let capture of obj.captures) {
                  this.addCapture(obj, capture);
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

              $(window).scrollTop(element.offset().top - fromTop);
            }.bind(this))
          );

        builder(element);
        return this.place(placement, element);
      },

      addResult: function(obj) {
        return this.addRevealer(obj, (element) => {
          element
            .addClass(() => (obj.shared) ? "shared" : "")
            .append($("<span>")
              .text(this.summary(obj)))
            ;
        });
      },

      addSummary: function(obj) {
        let element = $("<div>")
          .addClass("log_line expanded summary obj-" + obj.id)
          .addClass(() => (obj.shared) ? "shared" : "")
          .append($("<span>")
            .text(this.summary(obj)))
          ;

        return this.place(obj.placement, element);
      },

      addCapture: function(obj, capture) {
        if (!capture.what) {
          return;
        }

        if (typeof capture.what == "object") {
          let linkFrom = capture.what.linkFrom;
          let linkTo = capture.what.linkTo;
          if (linkTo && linkFrom) {
            let source = obj === linkTo ? linkTo : linkFrom;
            let target = obj === linkTo ? linkFrom : linkTo;
            return this.addRevealer(target, (element) => {
              element
                .addClass("expanded revealer obj-" + obj.id)
                .append($("<span>")
                  .text(this.quick(linkFrom) + " --> " + this.quick(linkTo)))
            }, capture, true, source);
          }

          let expose = capture.what.expose;
          if (expose) {
            return this.addRevealer(expose, (element) => {
              element
                .addClass("expanded revealer obj-" + obj.id)
                .append($("<span>").text("   " + this.quick(expose)))
            }, capture, true, obj);
          }

          // An empty or unknown capture is just ignored.
          return;
        }

        let time = capture.time.toISOString().replace(/[TZ]/g, " ").trim();
        let line = time + " \u2502 " + capture.thread + " \u2502 " + capture.what;
        let element = $("<div>")
          .addClass("log_line expanded obj-" + obj.id)
          .addClass(() => obj.shared ? "shared" : "")
          .append($("<pre>").text(line))
          ;

        return this.place(capture, element);
      },

      removeLine: function(position) {
        if (this.display[position] && --this.display[position].__refs === 0) {
          this.display[position].remove();
          delete this.display[position];
        }
      },

      // @param capture: the capture that revealed the object so that we can
      //                 reconstruct expansions on re-search.
      addBreadcrumb: function(expand, obj, parent, capture) {
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
          refs: 1,
          capture: capture,
          element: $("<span>")
            .addClass("branch").addClass(() => parent ? "child" : "parent")
            .css("background-color", this.objColor(obj))
            .text(this.quick(obj))
            .click(function(event) {
              if (this.bc_details) {
                this.bc_details.remove();
              }
              let element = $("<div>")
                .addClass("breadcrumb_details")
                .css("background-color", withAlpha(this.objColor(obj), 0.4))
                .append(
                $("<input>").attr("type", "button").addClass("button icon close").val(CLOSE_CROSS).click(function() {
                  if (this.bc_details) {
                    this.bc_details.remove();
                  }
                }.bind(this))
                );
              this.summary(obj, Object.keys, (obj, props) => {
                element.append($("<div>")
                  .text(this.quick(obj) + " created " + obj.placement.time.toISOString().replace(/[TZ]/g, " ").trim()));
                for (let prop of props) {
                  element.append($("<div>").text(prop + " = " + obj.props[prop]));
                }
              });

              $("#breadcrumbs").append(this.bc_details = $("<div>").append(element).append("<br>"));
            }.bind(this)),
        };

        let parentExpand = parent ? this.breadcrumbs.find(item => item.obj === parent) : null;
        if (parentExpand) {
          expand.element.insertAfter(parentExpand.element);
          this.breadcrumbs.after(expand, item => item.obj === parent);
        } else {
          $("#breadcrumbs").append(expand.element);
          this.breadcrumbs.push(expand);
        }
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
      },

      onExpansion: function(obj, parent, revealer, capture, revealed) {
        if (this.inFocus) {
          this.inFocus.removeClass("focused");
        }
        this.inFocus = revealer;
        this.inFocus.addClass("focused");

        let expand = this.breadcrumbs.find(item => item.obj === obj);
        if (revealed) {
          this.addBreadcrumb(expand, obj, parent, capture);
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



  $(() => {
    logan.init();
    
    $("#tools_button").click((event) => {
      alert("That's a nice settings icon, isn't? :D");
    });
    $("#files").on("change", (event) => {
      UI.clearResultsView();
      UI.setSearchView(true);
      logan.consumeFiles(UI, event.target.files);
    });

    $("#search_By").on("change", (event) => {
    }).change();

    $("#search_Matching").on("change", (event) => {
      (event.target.value === "*")
        ? $("#search_PropValue").hide() : $("#search_PropValue").show();
    }).change();

    $("#search_className").on("change", (event) => {
      let props = logan.searchProps[event.target.value] || {};
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
        value: $("#search_PropValue").val(),
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

    var files = $("#files").get()[0].files;
    if (files.length) {
      UI.clearResultsView();
      UI.setSearchView(true);
      logan.consumeFiles(UI, files);
    } else {
      UI.setInitialView();
    }
  });

})();
