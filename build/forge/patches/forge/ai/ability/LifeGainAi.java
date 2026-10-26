// Copied from Forge 2.0.15 (https://github.com/Card-Forge/forge, GPL-3.0), forge-ai/src/main/java/forge/ai/ability/LifeGainAi.java,
// with changes by Grimório (marked «Grimório» below): a lifegain ability that removes a +1/+1 counter from its
// creature is used in a loop when a permanent puts +1/+1 counters on whenever you gain life (Heliod, Sun-Crowned + Spike
// Feeder): before, the AI only gained life at 5 or less and never ran the combo.
// It is compiled into forge-ext and comes before the Forge jar in the classpath, so it replaces the original class
// (build/forge/build.sh).
package forge.ai.ability;

import com.google.common.collect.Iterables;
import forge.ai.*;
import forge.game.Game;
import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.cost.Cost;
import forge.game.cost.CostRemoveCounter;
import forge.game.cost.CostSacrifice;
import forge.game.phase.PhaseHandler;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.PlayerCollection;
import forge.game.player.PlayerPredicates;
import forge.game.spellability.SpellAbility;
import forge.util.MyRandom;

public class LifeGainAi extends SpellAbilityAi {

    /*
     * (non-Javadoc)
     * 
     * @see forge.ai.SpellAbilityAi#willPayCosts(forge.game.player.Player,
     * forge.game.spellability.SpellAbility, forge.game.cost.Cost,
     * forge.game.card.Card)
     */
    // Grimório: Heliod, Sun-Crowned + Spike Feeder — tirar o marcador volta a pôr um marcador (o gatilho do Heliod vai
    // para o Feeder pelo AITgts do guião), por isso é vida de graça; só com 2+ de resistência (o 0/0 morria antes)
    static boolean counterLoop(Player ai, SpellAbility sa) {
        Card host = sa.getHostCard();
        if (host == null || !host.isCreature() || sa.getPayCosts() == null || !sa.getPayCosts().hasSpecificCostType(CostRemoveCounter.class)
                || host.getNetToughness() < 2 || !ai.canGainLife() || ai.getLife() >= 80) {  // 80 chega: mais só atrasava o jogo (empates por tempo)
            return false;
        }
        for (Card c : ai.getCardsIn(forge.game.zone.ZoneType.Battlefield)) {
            for (forge.game.trigger.Trigger t : c.getTriggers()) {
                if (t.getMode() != forge.game.trigger.TriggerType.LifeGained) {
                    continue;
                }
                SpellAbility ex = t.ensureAbility();
                if (ex != null && ex.getApi() == forge.game.ability.ApiType.PutCounter && "P1P1".equals(ex.getParam("CounterType"))) {
                    return true;
                }
            }
        }
        return false;
    }

    @Override
    protected boolean willPayCosts(Player payer, SpellAbility sa, Cost cost, Card source) {
        if (counterLoop(payer, sa)) {
            return true;
        }
        final Game game = source.getGame();
        final PhaseHandler ph = game.getPhaseHandler();
        final int life = payer.getLife();

        boolean lifeCritical = life <= 5 || (ph.getPhase().isBefore(PhaseType.COMBAT_DAMAGE)
                && ComputerUtilCombat.lifeInDanger(payer, game.getCombat()));

        if (!lifeCritical) {
            // return super.willPayCosts(ai, sa, cost, source);
            if ("CriticalOnly".equals(sa.getParam("AILogic"))) {
                return false;
            }
            if (!ComputerUtilCost.checkSacrificeCost(payer, cost, source, sa, false)) {
                return false;
            }
            if (!ComputerUtilCost.checkLifeCost(payer, cost, source, 4, sa)) {
                return false;
            }

            if (!ComputerUtilCost.checkDiscardCost(payer, cost, source, sa)) {
                return false;
            }

            if (!ComputerUtilCost.checkRemoveCounterCost(cost, source, sa)) {
                return false;
            }
        } else {
            // don't sac possible blockers
            if (!ph.getPhase().equals(PhaseType.COMBAT_DECLARE_BLOCKERS)
                    || !game.getCombat().getDefenders().contains(payer)) {
                boolean skipCheck = false;
                // if it's a sac self cost and the effect source is not a
                // creature, skip this check
                // (e.g. Woodweaver's Puzzleknot)
                skipCheck |= ComputerUtilCost.isSacrificeSelfCost(cost) && !source.isCreature();

                if (!skipCheck) {
                    if (!ComputerUtilCost.checkSacrificeCost(payer, cost, source, sa,false)) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    @Override
    protected boolean checkPhaseRestrictions(final Player ai, final SpellAbility sa, final PhaseHandler ph) {
        if (counterLoop(ai, sa)) {
            return true;
        }
        final Game game = ai.getGame();
        final int life = ai.getLife();
        final String aiLogic = sa.getParamOrDefault("AILogic", "");

        boolean lifeCritical = life <= 5;
        lifeCritical |= ph.getPhase().isBefore(PhaseType.COMBAT_DAMAGE)
                && ComputerUtilCombat.lifeInDanger(ai, game.getCombat());

        // When life is critical but there is no immediate danger, try to wait until declare blockers
        // before using the lifegain ability if it's an ability on a creature with a detrimental activation cost
        if (lifeCritical
                && sa.isAbility()
                && sa.getHostCard() != null && sa.getHostCard().isCreature()
                && (sa.getPayCosts().hasSpecificCostType(CostRemoveCounter.class) || sa.getPayCosts().hasSpecificCostType(CostSacrifice.class))) {
            if (!game.getStack().isEmpty()) {
                SpellAbility saTop = game.getStack().peekAbility();
                if (saTop.getTargets() != null && Iterables.contains(saTop.getTargets().getTargetPlayers(), ai)) {
                    return ComputerUtil.predictDamageFromSpell(saTop, ai) > 0;
                }
            }
            if (!ph.inCombat()) { return false; }
            if (!ph.is(PhaseType.COMBAT_DECLARE_BLOCKERS)) { return false; }
        }

        // Sacrificing in response to something dangerous is generally good in any phase
        boolean isSacCost = sa.getPayCosts() != null && sa.getPayCosts().hasSpecificCostType(CostSacrifice.class);

        // Don't use lifegain before main 2 if possible
        if (!lifeCritical && ph.getPhase().isBefore(PhaseType.MAIN2) && !sa.hasParam("ActivationPhases")
                && !ComputerUtil.castSpellInMain1(ai, sa) && !aiLogic.contains("AnyPhase") && !isSacCost) {
            return false;
        }

        return lifeCritical || ComputerUtil.activateForCost(sa, ai)
                || (ph.getNextTurn().equals(ai) && !ph.getPhase().isBefore(PhaseType.END_OF_TURN))
                || sa.hasParam("PlayerTurn") || isSorcerySpeed(sa, ai);
    }

    /*
     * (non-Javadoc)
     * 
     * @see forge.ai.SpellAbilityAi#checkApiLogic(forge.game.player.Player,
     * forge.game.spellability.SpellAbility)
     */
    @Override
    protected AiAbilityDecision checkApiLogic(Player ai, SpellAbility sa) {
        final Card source = sa.getHostCard();
        final String sourceName = ComputerUtilAbility.getAbilitySourceName(sa);

        if (counterLoop(ai, sa)) {
            return new AiAbilityDecision(100, AiPlayDecision.WillPlay);
        }
        final int life = ai.getLife();
        final String amountStr = sa.getParam("LifeAmount");
        int lifeAmount = 0;
        boolean activateForCost = ComputerUtil.activateForCost(sa, ai);
        if (sourceName.equals("Dawnglow Infusion")
                || (amountStr.equals("X") && sa.getSVar(amountStr).equals("Count$xPaid"))) {
            lifeAmount = ComputerUtilCost.setMaxXValue(sa, ai, sa.isTrigger());
        } else {
            lifeAmount = AbilityUtils.calculateAmount(source, amountStr, sa);
        }

        // Ugin AI: always use ultimate
        if (sourceName.equals("Ugin, the Spirit Dragon")) {
            // TODO: somehow link with DamageDealAi for cases where +1 = win
            return new AiAbilityDecision(100, AiPlayDecision.WillPlay);
        }

        // don't use it if no life to gain
        if (!activateForCost && (lifeAmount <= 0 || !ai.canGainLife())) {
            return new AiAbilityDecision(0, AiPlayDecision.CantPlayAi);
        }

        if (sa.usesTargeting() && !target(ai, sa, true)) {
            return new AiAbilityDecision(0, AiPlayDecision.TargetingFailed);
        }

        if (ComputerUtil.playImmediately(ai, sa)) {
            return new AiAbilityDecision(100, AiPlayDecision.WillPlay);
        }

        if (isSorcerySpeed(sa, ai)
                || sa.getSubAbility() != null || playReusable(ai, sa)) {
            return new AiAbilityDecision(100, AiPlayDecision.WillPlay);
        }

        if (sa.getPayCosts() != null && sa.getPayCosts().hasSpecificCostType(CostSacrifice.class)) {
            // sac costs should be performed at Instant speed when able
            return new AiAbilityDecision(100, AiPlayDecision.WillPlay);
        }

        // Save instant-speed life-gain unless it is really worth it
        final float value = 0.9f * lifeAmount / life;
        if (value < 0.2f) {
            return new AiAbilityDecision(0, AiPlayDecision.CantPlayAi);
        }
        if (MyRandom.getRandom().nextFloat() < value) {
            return new AiAbilityDecision(100, AiPlayDecision.WillPlay);
        }
        return new AiAbilityDecision(0, AiPlayDecision.CantPlayAi);
    }

    /**
     * <p>
     * gainLifeDoTriggerAINoCost.
     * </p>
     * @param sa
     *            a {@link forge.game.spellability.SpellAbility} object.
     * @param mandatory
     *            a boolean.
     *
     * @return a boolean.
     */
    @Override
    protected AiAbilityDecision doTriggerNoCost(final Player ai, final SpellAbility sa, final boolean mandatory) {
        // If the Target is gaining life, target self.
        // if the Target is modifying how much life is gained, this needs to be
        // handled better
        if (sa.usesTargeting()) {
            if (!target(ai, sa, mandatory)) {
                return new AiAbilityDecision(0, AiPlayDecision.TargetingFailed);
            }
        }

        final String amountStr = sa.getParam("LifeAmount");
        if (amountStr.equals("X")) {
            ComputerUtilCost.setMaxXValue(sa, ai, true);
        }

        return new AiAbilityDecision(100, AiPlayDecision.WillPlay);
    }
    
    @Override
    public AiAbilityDecision chkDrawback(Player ai, SpellAbility sa) {
    	return doTriggerNoCost(ai, sa, true);
    }

    private boolean target(Player ai, SpellAbility sa, boolean mandatory) {
        Card source = sa.getHostCard();
        sa.resetTargets();
        // TODO : add add even more logic into it
        // try to target opponents first if that would kill them

        PlayerCollection opps = ai.getOpponents().filter(PlayerPredicates.isTargetableBy(sa));
        PlayerCollection allies = ai.getAllies().filter(PlayerPredicates.isTargetableBy(sa));

        if (sa.canTarget(ai) && ComputerUtil.lifegainPositive(ai, source)) {
            sa.getTargets().add(ai);
        } else {
            boolean hasTgt = false;
            // check for Lifegain negative on opponents
            for (Player opp : opps) {
                if (ComputerUtil.lifegainNegative(opp, source)) {
                    sa.getTargets().add(opp);
                    hasTgt = true;
                    break;
                }
            }
            if (!hasTgt) {
                // lifegain on ally
                for (Player ally : allies) {
                    if (ComputerUtil.lifegainPositive(ally, source)) {
                        sa.getTargets().add(ally);
                        hasTgt = true;
                        break;
                    }
                }
            }
            if (!hasTgt && mandatory) {
                // need to target something but its neither negative against
                // opponents, nor positive against allies

                // hurting ally is probably better than healing opponent
                // look for Lifegain not Negative (case of lifegain negated)
                for (Player ally : allies) {
                    if (!ComputerUtil.lifegainNegative(ally, source)) {
                        sa.getTargets().add(ally);
                        hasTgt = true;
                        break;
                    }
                }
                if (!hasTgt) {
                    // same for opponent lifegain not positive
                    for (Player opp : opps) {
                        if (!ComputerUtil.lifegainPositive(opp, source)) {
                            sa.getTargets().add(opp);
                            hasTgt = true;
                            break;
                        }
                    }
                }

                // still no luck, try to target ally with most life
                if (!allies.isEmpty()) {
                    Player ally = allies.max(PlayerPredicates.compareByLife());
                    sa.getTargets().add(ally);
                    hasTgt = true;
                }
                // better heal opponent which most life then the one with the lowest
                if (!hasTgt) {
                    Player opp = opps.max(PlayerPredicates.compareByLife());
                    sa.getTargets().add(opp);
                    hasTgt = true;
                }
            }
            return hasTgt;
        }
        return true;
    }
}
