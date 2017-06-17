# What is this?

**LOG AN**alizer (*'logan'*) is specifically designed for log files produced by applications based on the **Mozilla Gecko Platform** through [`MOZ_LOG`](https://developer.mozilla.org/en-US/docs/Mozilla/Debugging/HTTP_logging). This mainly means the Firefox browser.

The main focus is to search for objects of selected classes and their properties (e.g. `url`).  Secondary focus is to find links between objects and uncover the relation tree of objects in demand leaving all unimportant lines of the log hidden.

Part of the analyzer is [logan-rules.js](logan-rules.js) file containing set of matching rules to monitor objects lifetime, relations and properties.  It's hugely generic, thus very powerful and pretty much open to enhancements by anyone.  See below the **Rules definition reference** section for details.

The code has originally been published on [GitHub](https://github.com/mayhemer/logan) and a **live instance is running on [my site](https://janbambas.cz/moz/logan/)**.

# Current state

logan is in an early development stage.

### Under-the-hood features
- parsing rules written for networking objects (nsHttpChannel, nsHttpTransaction, nsHttpConnection and few others around.)

### Missing functionality
- interleaving and synchronization of parent and child logs #3
- processing of rotated logs #19
- revealing additional lines not captured on objects on demand in the UI #17
- way to easily customize the rules when using a life-staged instance #7
- reload of the same log file doesn't preserve performed searches

# How to use it

## 1. Select log files

After an initial load you see the first screen with a single purpose - to drop or browse for log files.  *In the current stage of development it's not practical to load more that a single file, specifically parent and child logs together*.  After the files are selected, you are brought to a second screen and can watch the loading progress bar in the heading.  When load is done, you can start searching.

*Notes: On a faster machine I can see load speeds of around 20MB/s.  Memory needed is about 3 times the size of the log.*

## 2. Search for an object by its class name and properties

First, select class name.  Second, select one of the properties that have been captured on the object.  Third, select the compare method and value you are looking for (like a pointer value, URI...)  Pressing the \[ Search \] button brings you to the next screen with results.

*Note about the `state` property: objects that have been released from memory (a destructor has been found in the log for them) has state `released`.  Rules for an object (see the **Rules definition reference** section and [logan-rules.js](logan-rules.js)) may change the `state` property during the object lifetime.  An example may be nsHttpTransaction that has been put on nsHttpConnection - its state is then `active`.  If rules don't change the `state`, object's `state` is then `created` between its creation and destruction.*

## 3. Results exploration

If some objects have matched the search criteria you should see the list of them on the screen.  Each line represents a summary of the object found, with few selected properties displayed right away.  They are ordered according the position in the log file (in general - by it's creation order.)

Each search result line has a check box at its left side:

- [ ] `2017-06-01 18:51:01.616 │ nsHttpTransaction │ 14D4C400 │ released │ - │ - │ https://example.com/`

When you check it, all lines captured from the log belonging to the object are revealed and given a distinct color.  *Note: there are 12 distict colors automatically assigned and rotated.*

Revealing more than one object interleaves the log lines with previous revealed object lines, always ordered according the position in the whole log file.

## 4. Links to referred or referring objects

Among lines of a revealed object you may find 'references' to and from other objects.  Those lines again have their own checkboxes:

- [ ] `nsHttpChannel @13ED1800 --> nsHttpTransaction @14D4C400`

Checking it reveals the related object (regardless if it's a link to or link from).  The object gets a new distinctive color.  These references allows you to explore the object chaining from the top to the bottom.  *A good example is the chain of nsHttpChannel linking nsHttpTransaction linking nsHttpConnection.  Revealing the nsHttpConnection object may then show what all other transactions have been dispatched on that connection.*

## 5. Breadcrumbs

At the top of the results view there is a sticky area outlining all objects that have been expanded.  The breadcrumbs are trying to keep up to with how the objects link to each other, but at this stage it's rather primitive.

Clicking a breadcrumb shows all properties captured on the object.  By default this shows the final state of the object (as it was at the end of the log.)  This can be changed using the `seek` function, see following section.

## 6. Changing the position in the log - seek

It may be useful to search for an object being in a certain state at an exact line in the log.  The seek controls can be found under the \[ Search \] button, appearing as:

seek: tail

A line to seek the log to can be easily selected by clicking the text **tail** and then picking a line from the results.

All previously performed search results will update according the new seek position.  Any new search will look for objects and their property values at the current seek position.

To seek back to the tail of the log, click the red &#x2b73; icon.

*Note: lines in the results view that are past the seek point are marked with a red bar in the front.*

# Rules definition reference

The rules are defined in [logan-rules.js](logan-rules.js) file in a hierarchy of a *schema* (a top level name-space) - currently there is only one - "`moz`", and *modules* within the schema.  A module is an equivalent of a mozilla log module (e.g. nsHttp, cache2).  See [logan-rules.js heading](https://github.com/mayhemer/logan/blob/master/logan-rules.js) for a life example, should be easy to follow what's going on.

*The schema pre-processes every line of the log with a defined root regular expression and a defined pre-process function.  If it matches, the function resolves the log module and the part of the line to be further processed by rules.  In the mozilla schema case it also sets up the thread on the processing state (described below).  If the line doesn't match the root regular expression, it's passed directly only to ruleIf and plainIf defined rules (see below) with the current thread being assumed the last one seen - yes, this is imperfect.*


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

The consuming function is called only when the line in the log file matches the formatting string.  Note that in 99% cases the rule string is simply a copy of the c++ `LOG()` formatting string in question.  *Internally the % directives are simply replaced with appropriate regular expressions - see [logan.js - printfToRegexpMap](https://github.com/mayhemer/logan/blob/master/logan.js#L56).*

For convenience the called consumer function is given the found values as arguments - containing strings, not objects directly.

`this` inside the function is assigned the **processing state** object.  Some of its properties and methods are:

- `this.thread`: an object representing the thread as found on the current line, this simple object lives through out the file processing and you can store properties on it at will to build ruleIf() and plainIf() conditions based on it (more on it below)
- `this.thread.name`: obviously the name of the thread
- `this.line`: the currently processed line, stripped the timestamp, thread name and module name
- `this.obj(identifier)`: this method returns a JS object representing the given `identifier` that can be then convenietly worked with, more below ; *note: the same object is always returned since its first call for the same identifier until `destroy()` is called on that object*

## Working with objects

To access an object the consumer function calls `this.obj(identifier)` as described above.  This returns an instance of `Obj` prototype.

Obj (an object) methods:
- `.create("classname")`: called from constructors, this puts the object to a 'created' state and assigns its class name; such a created object lives until .destroy() is called on it
- `.destroy()`: called from destructors, this sets the state of the object to 'released' and removes the object from the processing state; it means that a following call to `this.obj()` with the same identifier value will return a new blank instance
- `.capture("string" or no argument)`: this adds a line to the object so that it then appears in the results when the object is revealed in the results view; when there is no argument passed, the currently processed line is automatically added
- `.alias("alias")`: an object can be identified by multiple values sometimes thanks static_cast pointer shifts, wrapping helper classes ("handlers"), or simply by a unique key instead of a pointer; this method allows you to define such an alias so that calls to `this.obj("alias")` will resolve to this object
- `.grep()`: this conveniently instructs the object to capture all lines that contain the object's pointer or any of its aliases
- `.link("identifier" or object)`: this adds a 'this object links to other object' line, as described in the **Links to referred or referring objects** section above, the argument can be an identifier or an alias (will be resolved) or directly an object as returned by `this.obj()`; note that the link is automatically added to both objects, there is no need to link also backwards
- `.mention("identifier" or object)`: this simply adds a line that mentions the given object so that it can be revealed in the results view - a line with a checkbox; this doesn't establish any relation between the two objects
- `.prop("name", value, merge = false)`: sets or deletes a property on an object
  * when `value` has a value, it will be set under the name as a property on the object that you can then search by and examine
  * when `value` has a value and merge = true, it will be joined with the pre-existing value with ','
  * when `value` is undefined, the property will be removed from the object
  * when `value` is a function it will be called with one argument being the existing property value or 0 (a number) when the property has not yet been set, the result of the function is then stored as a new property value (ignoring the `merge` argument!); this is convenient for counters
  * the `merge` argument can be a function too, called with one argument being the object
  * note that reading a property back is only possible via direct access on object's `props` hashtable; it's strongly discouraged to modify this array directly as it would break properties history capture (seek)
- `.state(value or ommited)`: this is a shorthand to the "state" property of the object, if `value` has a value it's set on the object's "state", if called without arguments the method returns the current object's "state" value
- `.follow(consumer)`: use this to add few lines following the current line on the same thread; the `consumer` function is called as long as it returns something that evaluates to `true` AND none of the defined rules has so far matched a line on the current thread (note that the condition function can do anything it wants, not just capturing) ; the arguments are:
  * `obj`: the object this follow has been initiated for
  * `line`: the line being currently processed
  * `proc`: the processing state as described above
  * result: *true* to continue the follow, *false* to stop it

For convenience each of these methods (modulo documented exceptions) return back the object, so that they can be chained in the jQuery promise style.

To make the capturing process reliable there is a suggested ordering of calls when chained on one line:
1. create()
2. alias()
3. state() or prop()
4. capture()
5. link() or mention()
6. follow()
7. destroy()

## A conditional rule

This can be used for adding rules for lines that are too general or indistingushable or when the object to relate it to cannot be determined from the line itself.

An example of a conditional rule definition:

```javascript
schema.ruleIf("uri=%s", proc => proc.thread.httpchannel, function(url) {
  this.thread.httpchannel.prop("url", url);
  this.thread.httpchannel = null;
});
```
The rule assumes that a rule executed just before has set `thread.httpchannel` on the **processing state** to the object we want to assign the URL to.

The first argument to `schema.ruleIf()` is equal to what is being passed to `module.rule()`.  The second argument is a condition function that is evaluated prior to evaluating the formatting string.  It has an only argument - the processing state as described above.  If the condition function returns anything evaluating to `true` and the string matches, the function is called the same way as in the *simple rule* case.

Note: you can define more than one conditional rule with the same formatting string.

## A conditional plain rule

Execution of the consumer of such a rule is conditioned only by evaluation of the condition function and nothing else.

```javascript
schema.plainIf(proc => proc.thread.someCondition, function(line) {
  ...
});
```

The line argument is holding the currently processed line.

To process a plain line you can use `logan.parse(input, format, consumer, failure = null)` method:
* the `input` argument is the unprocessed input string (e.g. `line` from the example above)
* `format` is a printf formatting, same as in case of a rule definition to process the input
* `consumer` is called, when `input` is matching `format`, with arguments filled with resolved format parameters - the same way as in case of a rule consumer
* optional `failure`, if provided, is called when the input doesn't match the format, with one argument being the input

Note: `logan.parse()` can be used anywhere suitable, not just in plainIf() consumers.

# License

This is for general public use and spread at the moment.
