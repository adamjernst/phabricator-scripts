// ==UserScript==
// @name           Phabricator: Less Noise
// @version        1.0
// @description    Removes noisy blocks from the top of code reviews.
// @match          https://secure.phabricator.com/D*
// @match          https://phabricator.fb.com/D*
// ==/UserScript==

function injectJS(callback) {
  var script = document.createElement('script');
  script.textContent = '(' + callback.toString() + ')(window);';
  document.body.appendChild(script);
}

function injectStyles(styles) {
  var style = document.createElement('style');
  style.innerHTML = styles;
  document.body.appendChild(style);
}

injectStyles(
  '.less-noise-reviewers tr {' +
    'display: inline-block;' +
  '}' +
  '.less-noise-reviewers .phui-status-item-note {' +
    'width: auto;' +
  '}' +
  '.less-noise-reviewers .phui-status-item-target {' +
    'padding-right: 0;' +
  '}' +
  '.less-noise-reviewers table {' +
    'margin-left: 0 !important;' + // Overrides margin-left: -4px
  '}' +
  '.more-hiding-errors {' +
    'color: #f00;' +
  '}'
);

injectJS(function(global) {

  /* UTILITIES */

  function $(selector, start) {
    return (start || document).querySelector(selector);
  }

  function $$(selector, start) {
    return JX.$A((start || document).querySelectorAll(selector));
  }

  /* INIT */

  // Use `#complex` to disable these changes.
  if (global.location.hash === '#complex') {
    return;
  }

  function collapseBloatedSidebar() {
    var sidebar = $('.phui-property-list-actions');
    var hiddenSidebarItems = [];
    $$('li.phabricator-action-view', sidebar).forEach(function(sidebarItem){
      var text = sidebarItem.textContent.trim();
      if (text.indexOf('Remove ') == 0 && text.indexOf('Flag') != -1) {
        return;
      }
      JX.DOM.hide(sidebarItem);
      hiddenSidebarItems.push(sidebarItem);
    });
    var sidebarShowMoreA = JX.$N(
      'a',
      {
        href: '#',
        className: 'phabricator-action-view-item phabricatordefault-a',
      },
      'Show Actions'
    );
    var sidebarShowMoreLI = JX.$N(
      'li',
      {className: 'phabricator-action-view phabricatordefault-li'},
      [
        JX.$N(
          'span',
          {
            className: [
              'phui-icon-view sprite-icons',
              // Reuse the download sprite as it has a downward-
              // facing arrow that kinda resembles "see more".
              'icons-download',
              'phabricator-action-view-icon',
              'phabricatordefault-span'
            ].join(' '),
          }
        ),
        sidebarShowMoreA
      ]
    );
    sidebarShowMoreA.onclick = function(event){
      hiddenSidebarItems.forEach(function(sidebarItem){
        JX.DOM.show(sidebarItem);
      });
      JX.DOM.hide(sidebarShowMoreLI);
    };
    $('ul', sidebar).appendChild(sidebarShowMoreLI);
  }

  function hideDistractingCruft() {
    // Policy link is the "All Users" shown next to Accepted/Committed in the top; we don't use permissions at FB.
    // Keyboard shortcuts available? Who cares.
    // phabricator-crumbs-view is the bar at the top; on this page it shows no useful info.
    $$('.policy-link, .status-policy-all, .keyboard-shortcuts-available, .phabricator-crumbs-view').forEach(function(node){
      JX.DOM.hide(node);
    });

    // Hide the sprites indicating a reviewer hasn't reviewed yet, or those
    // "added by Herald," but leave those indicating accept/reject/etc.
    $$('.phui-icon-view.sprite-status.status-open, .phui-icon-view.sprite-status.status-open-white').forEach(function(node){
      JX.DOM.hide(node);
    });
  }

  function collapseSillySections() {

    var sections = {
      'Infer Analysis Results': function(node){
        return (node.textContent.indexOf('Infer OK') == -1) ? 'Infer Warning' : null;
      },
      'Build Size Info': function(node){
        return (node.textContent.indexOf('Build Sizes OK') == -1) ? 'Build Size Warning' : null;
      },
      'Holodeck': function(node){
        // Holodeck's iframe has some weird sizing bugs if we hide it now and show it later.
        // Just nuke the whole thing.
        node.innerHTML = '<a href="#complex">Show Holodeck</a>';
        return null;
      },
      'Lint': function(node){
        if (node.textContent.indexOf('Lint OK') != -1) {
          return null;
        }
        var errors = $$('.differential-results-row-red', node).length;
        var warnings = $$('.differential-results-row-yellow', node).length;
        var infos = $$('.differential-results-row-blue', node).length;
        var info = [];
        if (errors != 0) {
          info.push(errors.toString() + ' Lint Error' + (errors == 1 ? '' : 's'));
        }
        if (warnings != 0) {
          info.push(warnings.toString() + ' Lint Warning' + (warnings == 1 ? '' : 's'));
        }
        if (infos != 0) {
          info.push(infos.toString() + ' Lint Info' + (infos == 1 ? '' : 's'));
        }
        if (info.length != 0) {
          return info.join(', ');
        } else {
          return 'Lint Issues';
        }
      },
      'Unit': function(node){
        if (node.textContent.indexOf('Unit Test Errors') == -1) {
          return null;
        }
        var errors = $$('.differential-results-row-red', node).length;
        if (errors != 0) {
          return errors.toString() + ' Unit Test Error' + (errors == 1 ? '' : 's');
        }
        return 'Unit Test Errors';
      },
      'Perflab': null,
      'Scanlab': null,
      'Branch': null,
      'Arcanist Project': null,
      'Repository': null,
      'Commits': null,
      'Land': null,
      'Complete Test Run': function(node){
        var re = /(\d+) failures? not in trunk/;
        var match = node.textContent.match(re);
        if (match == null) {
          return null;
        }
        var failureCount = parseInt(match[1]);
        if (failureCount == 0) {
          return null;
        }
        return failureCount.toString() + ' Test Failure' + (failureCount == 1 ? '' : 's');
      },
      'Subscribers': null,
      'Async Build': null,
    };

    var lines = 'unknown';
    var authorNode = null;
    var nodesToHide = [];
    var sectionSummaries = {};

    $$('.phui-property-list-key').forEach(function(keyNode) {
      var valueNode = keyNode.nextSibling;
      var key = keyNode.textContent.trim();
      if (key == 'Author') {
        authorNode = $('a', valueNode);
        JX.DOM.hide(keyNode, valueNode);
      } else if (key == 'Lines') {
        lines = valueNode.textContent;
        JX.DOM.hide(keyNode, valueNode);
      } else if (key == 'Reviewers') {
        JX.DOM.alterClass(valueNode, 'less-noise-reviewers', true);
        $$('.phui-status-item-target', valueNode).slice(0, -1).forEach(function(node){
          node.appendChild(document.createTextNode(','));
        });
      } else if (key in sections) {
        var sectionFunction = sections[key];
        if (sectionFunction != null) {
          var sectionSummary = sectionFunction(valueNode);
          if (sectionSummary != null) {
            sectionSummaries[key] = sectionSummary;
          }
        }
        nodesToHide.push(keyNode);
        nodesToHide.push(valueNode);
      }
    });

    var subheader = $('.phui-header-subheader');
    JX.DOM.appendContent(subheader, JX.$N('span', lines + ' lines by '));
    JX.DOM.appendContent(subheader, authorNode);

    var propertyList = $('.phui-property-list-properties');
    nodesToHide.forEach(function(node){
      propertyList.appendChild(node);
      JX.DOM.hide(node);
    });

    var moreDT = JX.$N(
      'dt', 
      {className: 'phui-property-list-key phabricatordefault-dt'},
      'More'
    );

    if ('Complete Test Run' in sectionSummaries && 'Unit' in sectionSummaries) {
      // Unit overrides Complete Test Run
      delete sectionSummaries['Complete Test Run'];
    }

    var sectionSummaryValues = Object.keys(sectionSummaries).map(function(key){
      return sectionSummaries[key];
    });

    var moreA = JX.$N(
      'a',
      {
        href: '#', 
        className: 'phabricatordefault-a' + (sectionSummaryValues.length ? ' more-hiding-errors' : '')
      },
      sectionSummaryValues.length == 0 ? 'Nothing of note' : sectionSummaryValues.join(', ')
    );
    moreA.onclick = function(event){
      nodesToHide.forEach(function(node){
        JX.DOM.show(node);
      });
      JX.DOM.hide(moreDT, moreDD);
      event.stopPropagation();
    };

    var moreDD = JX.$N(
      'dd', 
      {className: 'phui-property-list-value phabricatordefault-dd'}
    );
    moreDD.appendChild(moreA);

    JX.DOM.appendContent(propertyList, moreDT);
    JX.DOM.appendContent(propertyList, moreDD);

  }

  function nukeStupidBoxes() {
    var stupidBoxes = [
      'Open Revisions Affecting These Files',
      'Revision Update History',
      'Local Commits',
    ];

    $$('.phui-box').forEach(function(box){
      var header = $('h1', box);
      if (header == null) {
        return;
      }
      stupidBoxes.forEach(function(stupidBox){
        if (box.parentNode && header.textContent.indexOf(stupidBox) != -1) {
          box.parentNode.removeChild(box);
        }
      });
    });
  }

  collapseBloatedSidebar();
  hideDistractingCruft();
  collapseSillySections();
  nukeStupidBoxes();

});
