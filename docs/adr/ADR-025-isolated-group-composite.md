# ADR-025: Isolated Group composition

Status: Accepted

Groups render children into an isolated intermediate buffer before applying group opacity and blend to the parent. Pass-through is deferred because a partial implementation would diverge across render and export paths.
