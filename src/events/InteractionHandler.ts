import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  AutocompleteInteraction,
  CacheType,
  Collection,
  CommandInteraction,
  Events,
  REST,
  Routes,
  StringSelectMenuInteraction,
} from "discord.js";

import { Event } from "../core/Event";
import { Context, Interaction } from "../core/Interaction";
import { container } from "tsyringe";

// TODO : Refactor this, it works for now
export default class InteractionHandler extends Event {
  /**
   * The interactions collection.
   *
   * @type {Collection<string, Interaction>}
   * @readonly
   */
  private readonly interactions: Collection<string, Interaction>;

  constructor() {
    super("onInteraction", Events.InteractionCreate);

    this.interactions = new Collection<string, Interaction>();

    this.init();
  }

  /**
   * Initializes the interaction handler.
   */
  async init(): Promise<void> {
    const dir = readdirSync(join(resolve("interactions")));

    this.client.logger.info(`Loading ${dir.length} interactions categories.`);

    for (const category of dir) {
      const files = readdirSync(join(resolve("interactions", category)));

      this.client.logger.info(`Loading ${files.length} interactions from category ${category}.`);

      for (const file of files) {
        if (!file.endsWith(".js")) continue;
        const commandClass = (await import(join(resolve(), "interactions", category, file))).default;
        const interaction = container.resolve<Interaction>(commandClass);
        this.client.logger.info(`Loading interaction ${interaction.command.name}.`);
        this.interactions.set(interaction.command.name, interaction);
      }
    }

    this.client.setInteractions(this.interactions);
  }

  /**
   * Refreshes the interactions.
   * This will update the interactions on Discord.
   */
  private async refresh() {
    const ready = this.client.readyAt
      ? Promise.resolve()
      : new Promise((resolve) => this.client.once(Events.ClientReady, resolve));

    await ready;

    const rest = new REST().setToken(process.env.TOKEN);

    try {
      this.client.logger.info(`Started refreshing ${this.interactions.size} application (/) commands.`);

      const data = (await rest.put(Routes.applicationCommands(this.client.user.id), {
        body: this.interactions.map((interaction) => interaction.command),
      })) as any;

      this.client.logger.info(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
      this.client.logger.error(`Failed to reload application (/) commands: ${error}`);
    }
  }

  /**
   * Runs the interaction.
   *
   * @param interaction - The interaction.
   *
   * @returns {Promise<void>} - Returns nothing.
   */
  async run(interaction: CommandInteraction<CacheType>): Promise<any> {
    if (!this.client.isReady) return undefined;
    if (!interaction) return undefined;

    let guild = null;

    if (interaction.inGuild()) guild = await this.client.repository.guild.findOrCreate(interaction.guildId);

    let context = {} as Context;

    context.client = this.client;
    context.guild = guild;

    if (interaction.isChatInputCommand()) {
      if (!this.interactions.has(interaction.commandName)) return undefined;

      this.client.logger.info(`Command ${interaction.commandName} was executed in ${interaction.guildId || "DM"}`);

      const command = this.interactions.get(interaction.commandName);

      this.client.logger.debug(command);

      if (!command) return undefined;

      this.client.logger.info(`Command ${command.command.name} was executed in ${interaction.guildId || "DM"}`);

      try {
        await command.run(interaction, context);
      } catch (error) {
        this.client.logger.error(`Failed to run interaction ${interaction.commandName}: ${error}`);
      }
    }

    if (interaction.isAutocomplete()) {
      const autocomplete = interaction as AutocompleteInteraction;

      if (!this.interactions.has(autocomplete.commandName)) return undefined;

      const command = this.interactions.get(autocomplete.commandName);

      if (!command) return undefined;

      try {
        await command.autocomplete?.(interaction);
      } catch (error) {
        this.client.logger.error(`Failed to run autocomplete for interaction ${command.command.name}: ${error}`);
      }
    }

    if (interaction.isStringSelectMenu()) {
      const selectMenu = interaction as StringSelectMenuInteraction;

      const id = selectMenu.customId.split("_")[0];

      if (!this.interactions.has(id)) return undefined;

      const command = this.interactions.get(id);

      if (!command) return undefined;

      try {
        await command.selectMenu?.(interaction);
      } catch (error) {
        this.client.logger.error(`Failed to run interaction ${selectMenu.customId}: ${error}`);
      }
    }
  }
}
