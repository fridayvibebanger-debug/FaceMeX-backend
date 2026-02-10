const order = { free: 0, pro: 1, creator: 2, business: 3, exclusive: 4 };

export function requireTier(minTier = 'free') {
  return (req, res, next) => {
    const user = req.user || { id: '1', tier: 'free' };
    const u = order[user.tier] ?? 0;
    const m = order[minTier] ?? 0;
    if (u >= m) return next();
    return res.status(403).json({ error: 'upgrade_required', required: minTier, current: user.tier });
  };
}
