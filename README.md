# What is this?

**LOG AN**alizer (*'logan'*) is specifically designed for log files produced by applications based on the **Mozilla Gecko Platform** through [`MOZ_LOG`](https://developer.mozilla.org/en-US/docs/Mozilla/Debugging/HTTP_logging). This mainly means the Firefox browser.

The main focus is to search for objects of selected classes and their properties (e.g. `url`).  Secondary focus is to walk the object linking chain to reach the "the line" while everything uninterested is filtered off.

The analyzer is based on [logan-rules.js](logan-rules.js) file containing set of matching rules to track objects lifetime, relations and properties.  It's hugely generic, thus very powerful and pretty much open to enhancements by anyone.  See below the **Rules definition reference** section for details.

The code has originally been published on [GitHub](https://github.com/mayhemer/logan) and a **live instance is running on [my site](https://janbambas.cz/moz/logan/)**.

# Current state

logan works for most use cases and logs produced with current Firefox Nightly for mainly diagnosing networking issues.  It can process parent and child logs together.

### Missing functionality
- revealing additional lines not captured on objects on demand in the UI [#17]
- way to easily customize the rules when using a life-staged instance [#7]
- no worker to do parsing and searching off the main thread (expect your browser to be freezing with large logs)

# How to use it

## 1. Select log files

The first screen has a single purpose - to drop or browse for log files.  After the files are selected, you are brought to a secondary screen and can watch the loading progress bar in the heading.  When load is done, you can start searching.  *Note that a 64-bit browser is recommended for larger logs.*

## 2. Search for an object by its class name and properties

First, select a class name.  Second, select one of the properties that have been captured on the objects.  You can also search by a line captured on an object.  Third, select the compare method and value you are looking for (e.g. a URI.)  Pressing the \[ Search \] button brings you to the next screen with results.

(*Note about the `state` property: objects that have been released from memory (a destructor has been found in the log for them) has state `released`.  Rules for an object (see the **Rules definition reference** section and [logan-rules.js](logan-rules.js)) may change the `state` property during the object lifetime.  An example is nsHttpTransaction that has been put on nsHttpConnection - its state is then `active`.  If rules don't change the `state`, object's `state` is then `created` between its creation and destruction.*)

## 3. Results exploration

If some objects have matched the search criteria you will see a list of them on the screen.  Each line represents a summary of the object found, with few selected properties displayed right away.  The objects are ordered according the position in the log file (in general - by it's creation order.)

Each search result line has a check box at its left side:

- [ ] `2017-06-01 18:51:01.616 │ nsHttpTransaction │ 14D4C400 │ released │ - │ - │ https://example.com/`

When you check it, all lines captured from the log belonging to the object are revealed and given a distinct color.

Revealing more than one object interleaves the log lines with previously revealed object lines, always ordered according the position in the whole log file(s).

## 4. Links to referred or referring objects

Among lines of a revealed object you may find 'references' to and from other objects.  Those lines again have their own checkboxes:

- [ ] `nsHttpChannel @13ED1800 --> nsHttpTransaction @14D4C400`

Checking it reveals the related object.  The object gets a new distinctive color.  These references allows you to explore the object chaining from the top to the bottom.  (*A good example is the chain of nsHttpChannel linking nsHttpTransaction linking nsHttpConnection etc.  Revealing the nsHttpConnection object may then show what all other transactions have been dispatched on that connection.*)

## 5. Breadcrumbs

At the top of the results view there is a sticky area listing all objects that have been expanded.

Clicking a breadcrumb shows all properties captured on the object.  By default this shows the final state of the object (as it was at the end of the log.)  This can be changed using the `seek` function, see following section.

## 6. Changing the position in the log via 'seek'

It may be useful to search for an object being in a certain state at an exact line in the log.  The seek controls can be found under the \[ Search \] button, appearing as:

seek: tail

A line to seek the log to can be easily selected by clicking the text **tail** and then picking a line from the results.

After that details of previously searched objects will show the properties state at the new seek position.

Any new search will look for objects and their property values at the current seek position.

To seek back to the tail of the log, click the red &#x2b73; icon.

*Note: lines in the results view that are past the seek point are marked with a red bar in the front.*

## 7. Network diagnostics

This is experimental, but may be really helpful when finding or verifying scheduling and prioritization problems and enhancements.  **This works only for `nsHttpChannel` objects.  The parent log must be loaded along with all the child logs.  The log files must have been captured on Firefox 57 with following modules:**  

    MOZ_LOG=timestamp,sync,nsHttp:5,cache2:5,DocumentLeak:5,PresShell:5,DocLoader:5,nsDocShellLeak:5,RequestContext:5,LoadGroup:5,nsSocketTransport:5

The details pane of an nsHttpChannel - opened with a breadcrumb click - has a [diagnose] button at the top.  It opens a diagnostic page that puts this channel to its request context, listing various timing and other properties of the channel.  The page also lists all other channels running in parallel to or before the diagnosed channel (within the page laod), broke down by various conditions.  It's better to try this live than to describe here, also because this is still developing.  All should be hopefully self-explanatory.

The code lives in [logan-netdiag.js](logan-netdiag.js) with API referred from the rules (in a bit quick-hacky-duplication way, subject to change.)

# Rules definition reference

The rules are defined in [logan-rules.js](logan-rules.js) file in a hierarchy of a *schema* (a top level name-space) - currently there is only one - "`moz`", and *modules* within the schema.  A module is an equivalent of a mozilla log module (e.g. nsHttp, cache2).  See [logan-rules.js heading](https://github.com/mayhemer/logan/blob/master/logan-rules.js) for a life example, should be easy to follow what's going on.

*A schema pre-processes every line with a pre-processing regexp and function.  The `moz` schema parses and separates the time stamp, module name, thread name and the actual log text.  Lines w/o the timestamp/thread/module prefix will use the last known timestamp and thread values.*


The rules themselves need a bit more thorough explanation.

There are 3 types of rules that you can define:
1. a simple rule by a printf formatting - via `module.rule()`
2. a more general printf rule conditioned by a state evaluation - via `schema.ruleIf()`
3. a general rule (no string matching) only conditioned by a state - via `schema.plainIf()`

## A simple rule

An example of its definition:

```javascript
module.rule("nsHttpChannel %p created nsHttpTransaction %p", function(channel, transaction) {
  this.obj(channel).capture().link(transaction);
});
```

The consuming function is called only when the line in the log file matches the formatting string.  Note that in 99% cases the rule string is simply a copy of the C++ `LOG()` formatting string in question.

For convenience the called consumer function is given the found values as arguments - containing strings, *not* objects or numbers directly.

`this` inside the function is assigned the **processing state** object.  Some of its properties and methods are:

- `this.thread`: an object representing the thread as found on the current line, this simple object lives through out the file processing and you can store properties on it at will to build ruleIf() and plainIf() conditions based on it (more on it below)
- `this.thread.name`: obviously the name of the thread
- `this.thread.on("property", handler)`: a convenience method to perform a conditioned operation + change value or nullify the property in one easy step ; the handler is called when the property is non-null on the thread, the handler is passed value of that property as an argument, return value of the handler replaces the value of that property on the thread (note that when you don't return a value it effectively nullifies the property)
- `this.line`: the currently processed line, stripped the timestamp, thread name and module name
- `this.timestamp`: a Date object holding the time as read from the log line
- `this.obj(identifier)`: this method returns a JS object representing the given `identifier` that can be then conveniently worked with, more below ; *note: the same object is always returned since its first call for the same identifier until `destroy()` is called on that object*
- `this.objIf(identifier)`: same as above, but only a temporary object is returned when the object didn't exist before; this prevents null-checks in the rule code
- `this.duration(timestamp)`: calculates number of milliseconds since timestamp till now, timestamp is expected to be a Date object, the result is a number of milliseconds

## Working with objects

To access an object a rule consumer function calls `this.obj(identifier)` as described above.  That returns an instance of `Obj` prototype.

Obj (an object) methods:
- `.create("classname")`: called from constructors, this puts the object to a 'created' state and assigns its class name; such a created object lives until .destroy() is called on it; if called on an already created object, that existing object is first destroyed and then a new plain object is created and returned; a warning is shown in the web console that an object's been recreated
- `.destroy(["classname"])`: called from destructors, this sets the state of the object to 'released' and removes the object from the processing state; it means that a following call to `this.obj()` in rules with the same identifier value will return a new blank object; if "classname" is provided, the object is destroyed only when the object's class name is identical to it
- `.capture("string" or no argument)`: this adds a line to the object so that it then appears in the results when the object is expanded in the results view; when there is no argument passed, the currently processed line is automatically added
- `.alias("alias")`: an object can be identified by multiple values sometimes thanks static_cast pointer shifts, wrapping helper classes ("handlers"), or simply by a unique key side by a pointer; this method allows you to define such an alias so that calls to `this.obj("alias")` will resolve to this object
- `.grep()`: this conveniently instructs the object to capture all lines that contain the object's pointer or any of its aliases
- `.link("identifier" or object)`: this adds a 'this object links to other object' line, as described in the **Links to referred or referring objects** section above, the argument can be an identifier or an alias (will be resolved) or directly an object as returned by `this.obj()`; note that the link is automatically added to both objects with the correct vector
- `.mention("identifier" or object)`: this simply adds a line that mentions the given object so that it can be expanded in the results view - via a line with a checkbox; this doesn't establish any relation between the two objects
- `.prop("name", value, merge = false)`: sets or deletes a property on an object
  * when `value` has a value, it will be set under the name as a property on the object that you can then search by and examine
  * when `value` has a value and merge = true, it will be joined with the pre-existing value with ','
  * when `value` is undefined, the property will be removed from the object
  * when `value` is a function it will be called with one argument being the existing property value or 0 (a number) when the property has not yet been set, the result of the function is then stored as a new property value (ignoring the `merge` argument!); this is convenient for counters
  * the `merge` argument can be a function too, called with one argument being the object
  * note that reading a property back is only possible via direct access on object's `props` simple object (a hashtable); it's strongly discouraged to modify this array directly as it would break properties history capture (seek)
- `.propIfNull("name", value)`: sets the property but only when it's not already present; use to set a property only once
- `.propIf("name", value, cond, merge)`: sets the property only when `cond` evaluates to `true`; the `cond` function is called with the object as the only argument
- `.props`: property Bag - a simple object - holding all the currently captured properties for reading, provides `.on("property", handler)` method for convenience, see **this.thread.on** above for details
- `.state(value or ommited)`: this is a shorthand to the "state" property of the object, if `value` has a value it's set on the object's "state", if called without arguments the method returns the current object's "state" value
- `.expect("format", consumer[, unmatch])`: use this to process lines following the current line on the same thread; `consumer` and optional `unmatch` handlers will be called as long as their results evaluate to `true`

  `consumer` is called only when a line matches the format string, the arguments are:
  * this: the processing state
  * `obj`: the object this follow has been initiated for
  * found values: passed the same way as for a rule consumer (see **A simple rule** section)
  * `proc`: the processing state, once more
  * result: *true* to continue the follow, *false* to stop it

  the optional `unmatch` handler is called when a line doesn't match the format with following arguments:
  * this: the processing state
  * `obj`: the object this follow has been initiated for
  * `line`: the line being currently processed
  * result: *true* to continue the follow, *false* to stop it
- `.follow("format", consumer[, unmatch])`: the same as `.expect()` but stops when any rule from the same module matches a line on the same thread where this follow has been started, this is convenient for cases one doesn't know if the line matching "format" will or will not follow the currently processed line
- `.follow(consumer)`: similar to the above form of `.follow()` but without a rule-like formating; the `consumer` function is called for lines with the same module or non-prefixed lines as long as no other rule from the same module matches on the same thread and as long as the the consumer's result is evaluating to `true` (note that the consumer function can do anything it wants, not just capturing) ; the arguments are:
  * `obj`: the object this follow has been initiated for
  * `line`: the line being currently processed
  * `proc`: the processing state as described above
  * result: *true* to continue the follow, *false* to stop it
- `.follow(n)`: this will simply capture *n* following lines on this thread and module or non-prefixed lines, the follow will stop sooner if a rule matches on the thread
- `.ipcid(id)`: this sets a globally unique interprocess identifier on the object so that `.send()` and `.recv()` synchronization will then work between parent and child process log files on different objects with the same ipcid
- `.ipcid()`: returns the assigned id, if any
- `.send("message")`: sends a message (unblocks corresponding `recv()`, see below) from one log file to another, has an effect only when all of:
  * `ipcid` has been assigned on this object
  * there are parent and child log files loaded in logan
- `.recv("message", handler)`: used for synchronization between child and parent logs, the `handler` is called only when all of:
  * `ipcid` has been assigned on this object
  * there are parent and child log files loaded in logan
  * the corresponding `.send("message")` has been called; correspondence here means the sender has the same ipcid as the receiver and the message string is identical

  In case we hit a line with a .recv() call sooner than the corresponding .send() line in another log file (because of tight or non-synchronous timestamps) recv() stops parsing of this log file until the corresponding .send() is hit in one of the other log files.  Only then the `handler` is called with two arguments: `receiver` and `sender` where `receiver` is the object recv() has been called on and `sender` is the object that called the corresponding send().

  In case the corresponding send() has already been hit, the `handler` is called immediately.
- `.class("name")`: gives a class name to objects that are not tracked (no rules defined for them) or are partial in the log (long-living) which has been started later during the session; calling this on an object that has not been `create()`ed will give it a class name "name" by which you can then search the object for, state is set to "partial" and "missing-constructor" property is set to `true`; calling this on an object that has been `create()`ed doesn't do anything
- `.on("object_property", handler)`: see **this.thread.on** above for details, note this is working with JS properties you may have set directly on the *Obj* instance and not what has been set with the *.prop()* method!

For convenience each of these methods (modulo documented exceptions) return back the object, so that they can be chained in the jQuery promise style.

To make the capturing process reliable there is a suggested ordering of calls when chained on one line:
1. create()
2. alias()
3. state() or prop()
4. recv()
5. capture()
6. send(), link() or mention()
7. follow()
8. destroy()

## A conditional rule

This can be used for adding rules for lines that are too general or indistinguishable or when the object to relate it to cannot be determined from the line itself.

An example of a conditional rule definition:

```javascript
schema.ruleIf("uri=%s", proc => proc.thread.httpchannel, function(url, channel) {
  delete this.thread.httpchannel; // we only want to hit this once
  channel.prop("url", url);
});
```
The rule assumes that a rule executed just before has set `thread.httpchannel` on the **processing state** to the object we want to assign the URL to.

The first argument to `schema.ruleIf()` is equal to what is being passed to `module.rule()`.  The second argument is a condition function that is evaluated prior to evaluating the formatting string.  It has an only argument - the processing state as described above.  If the condition function returns anything evaluating to `true` and the string matches, the function is called the same way as in the *simple rule* case with one added argument at the end - the result of the condition for convenience.

Note: you can define more than one conditional rule with the same formatting string.

## A conditional plain rule

Execution of the consumer of such a rule is conditioned only by evaluation of the condition function and nothing else.

```javascript
schema.plainIf(proc => proc.thread.someCondition, function(line, condition) {
  ...
});
```

The line argument is holding the currently processed line.  The condition argument keeps the result of the condition evaluation (proc.thread.someCondition in this case.)

To process a plain line you can use `logan.parse("input", "format", consumer[, failure])` method:
* the `input` argument is the unprocessed input string (e.g. `line` from the example above)
* `format` is a printf formatting, same as in case of a rule definition to process the input
* `consumer` is called, when `input` is matching `format`, with arguments filled with resolved format parameters - the same way as in case of a rule consumer
* optional `failure`, if provided, is called when the input doesn't match the format, with one argument being the input

# License

This is for general public use and spread at the moment.
