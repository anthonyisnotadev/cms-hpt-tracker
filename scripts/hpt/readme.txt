===============================================================================
HOSPITAL PRICE FILE FINDER
Plain-English guide. No technical background needed.
===============================================================================


WHAT THIS IS
------------

Every hospital in the United States is required by law to publish its prices
in a file that computers can read. This tool finds those files.

It starts from the official CMS list of 5,419 hospitals and, for each one,
tries to answer three questions:

  1. What is this hospital's website?
  2. Where is its price file?
  3. When was that price file last updated?

The answers go into a spreadsheet you can open in Excel.


WHY IT IS HARDER THAN IT SOUNDS
-------------------------------

The government's hospital list does not include website addresses. It has
names and street addresses and nothing else.

So we know exactly what we are looking for, and have no idea where to look.
Finding the websites IS the job. Everything else follows easily once you
know a hospital's web address.


HOW IT WORKS
------------

The rules say a hospital must put a small text file at its web address, at
a fixed spot:

    https://thehospital.com/cms-hpt.txt

That little file says "here is where my price list lives."

The useful part: that file also lists WHICH hospitals it covers, by name.
So it identifies itself. That means we can simply guess a web address, look
for the file, and let the file tell us whether we guessed right. A wrong
guess costs nothing but a moment.

That single fact shapes everything:

  * We do not need an expensive search service. Cheap guesses work, because
    every guess gets checked for free.

  * Guesses come from several places: an open dataset of known price-file
    links, Wikidata, a web search, and the files of other hospitals.

  * Large hospital chains list every hospital they own in one file. The file
    at encompasshealth.com names 185 hospitals. One lucky guess can answer
    the question for dozens of hospitals at once.


THE HARD PART: MAKING SURE IT IS THE RIGHT HOSPITAL
---------------------------------------------------

Hospital names repeat constantly. There is a "St. Mary's Hospital" in many
different states. There are three hospitals named "Mercy Regional Medical
Center." Matching on the name alone produces wrong answers that look right.

Two things prevent that:

  1. Every price file contains the hospital's own street address and the
     state it is licensed in. We read that and check it agrees. If a file
     says Virginia and the hospital is in Arizona, it is not a match, no
     matter how well the names line up.

  2. Hospitals get bought and renamed. "Baptist Health Shelby Hospital" is
     the same building as "SHELBY BAPTIST MEDICAL CENTER" after a change of
     owner. Names like that are sent to an AI, which is given the addresses
     and asked whether it is the same place. Only confident yes answers are
     accepted.

Everything in the final spreadsheet was checked against the address inside
the price file. At the last check, 1,237 out of 1,237 checkable rows agreed.


WHAT YOU GET
------------

Three spreadsheets, in the folder cms_data/hpt/ :

  manifest.csv
      The answer. One row per hospital: its website, its price file link,
      and when that file was last updated. 3,486 hospitals so far.

  compliance.csv
      Who is following the rules and who is not. Every hospital is labelled
      with what we observed and the evidence for it.

  gaps.csv
      The hospitals we could not resolve, each labelled with what would fix
      it, so the remaining work can be handed off or done later.


WHAT WE FOUND
-------------

Of 5,419 hospitals:

  3,486   price file found and confirmed          (64%)
  2,841   of those also have a last-updated date
  1,933   not resolved yet                        (36%)
    164   of those are federal hospitals (VA and military), which the
          rules exempt, so they have no file to find in the first place

We could actually assess 3,629 hospitals. Of those, 2,908 were publishing
their prices (2,473 of them with a confirmed date; for the other 435 the file
was there but its date could not be read), and 721 had a problem:

    278   price file link is broken
    121   price file more than a year old (the rules require yearly updates)
    119   website refuses automated visitors on the price-file location
     93   file uses an outdated government template
     67   website refuses automated visitors on the price file itself
     37   publishes no price-file pointer at all, though the site works
      6   pointer file names the hospital but gives no link to its price file

The blocking is concentrated. Two hospital chains account for 68 of the 186
blocked hospitals, across 78 domains in total.

A further 379 hospitals sit in their own category: we found a working price
file on their health system's website, but that file does not mention them.
Either the system left them out, or our name matching missed them. Because
we cannot tell which, they are reported as "not named in file" rather than
counted against the hospital.


AN IMPORTANT DISTINCTION
------------------------

The report carefully separates two different things:

  "This hospital did not publish its prices."   <- a finding about them
  "We could not find this hospital's website."  <- a gap in our own work

Only the first is reported as a problem. About 1,600 hospitals fall into the
second group, and they are marked "not assessed" rather than counted as
breaking the rules. Mixing those two together would have made the numbers
look several times worse than reality and the report worthless.


HOW TO RUN IT
-------------

You need Node.js installed. From the project folder:

    node scripts/hpt/run.js seed          prepare the hospital list
    node scripts/hpt/run.js pointers      look for price files
    node scripts/hpt/run.js match         work out which file belongs to whom
    node scripts/hpt/run.js dates         find when each file was updated
    node scripts/hpt/run.js compliance    produce the compliance spreadsheet
    node scripts/hpt/run.js audit         check the results contradict nothing
    node scripts/hpt/run.js report        show a summary

Every step can be stopped and restarted. It remembers what it already did
and picks up where it left off. Nothing is lost if you close the window.

For the full list of steps and options:

    node scripts/hpt/run.js


WHAT IT COSTS
-------------

Almost nothing. The work so far cost about zero dollars: the web searches
fit inside a free allowance, and the AI checking cost a few cents.

Fetching the price files themselves is free. Note that the price files are
large, often 100 to 300 megabytes each, so downloading all of them would
need a lot of disk space. This tool reads only the first few kilobytes of
each file to get the date, which avoids that entirely.


LIMITS, HONESTLY
----------------

100% is not achievable. Some hospitals genuinely do not publish these
files, federal hospitals are exempt, and some websites cannot be reached at
all. The realistic ceiling is somewhere in the high eighties as a percentage
of hospitals that actually have a file to find.

The remaining work is known and listed in gaps.csv. Most of it needs either
a fresh month of free web searches or a service that can get past sites
which block automated visitors.


For the technical details, see README.md in this same folder.
===============================================================================
