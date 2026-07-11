# ADR-010: Virtualize Timeline columns

Status: Accepted

Timeline renders only the Frame columns intersecting the horizontal viewport plus a small overscan. Spacer columns preserve scroll geometry and headers remain fixed. A full Frame×Layer DOM grid was rejected because 500 Frame documents would create thousands of reactive elements. Thumbnail caching is capped with an LRU and keyed by shared image ID plus revision.
